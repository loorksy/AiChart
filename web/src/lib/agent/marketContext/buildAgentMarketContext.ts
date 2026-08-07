/**
 * Builds the multi-timeframe market context the specialist agents reason on.
 * Candles come from the warehouse (current TF, higher TF, daily) so the agent
 * sees hundreds–thousands of bars, not the ~120 the legacy analyze path used.
 *
 * When coverage is thin, this path performs a bounded synchronous refill from
 * the approved server-side source, re-reads the warehouse, then reports exact
 * available/required counts. The chart viewport is never treated as the full
 * analytical history.
 */
import {
  detectCandleGaps,
  getCandles,
} from "@/lib/candles/candleRepository";
import {
  backfillCandles,
  triggerBackfill,
} from "@/lib/candles/candleBackfillService";
import {
  getHigherInterval,
  normalizeCanonicalInterval,
  candleFreshnessToleranceMs,
} from "@/lib/markets/intervals";
import { forexCanonicalKey } from "@/lib/markets/forexCanonical";
import { isForexMarketOpen } from "@/lib/agent/marketSession";
import {
  CANDLE_COVERAGE_POLICY_VERSION,
  DATA_QUALITY_POLICY,
  buildCandleCoverageReport,
  type CandleCoverageReport,
  type CoverageAnalysisKind,
} from "@/lib/agent/dataQualityPolicy";
import {
  calculateAtr,
  detectLiquidity,
  detectMajorLevels,
  detectMarketRegime,
  detectSupplyDemandZones,
  type AgentCandle,
} from "./detectors";
import type { AgentChartContext } from "../types";
import { getFreshAgentCandles } from "./getFreshAgentCandles";
import {
  evaluateMarketSync,
  type MarketSyncStatus,
} from "./marketSyncGuard";
import { enqueue } from "@/lib/queue";

/**
 * Fire-and-forget gap repair with a per-series cooldown so a chatty session
 * cannot stampede the broker feed. The queue's idempotency key (bucketed to the same
 * window) dedupes across processes when Redis is available.
 */
const GAP_REPAIR_COOLDOWN_MS = 10 * 60 * 1000;
const gapRepairLastFired = new Map<string, number>();

function triggerGapRepair(symbol: string, interval: string): void {
  const key = `${symbol}:${interval}`;
  const now = Date.now();
  const last = gapRepairLastFired.get(key) ?? 0;
  if (now - last < GAP_REPAIR_COOLDOWN_MS) return;
  gapRepairLastFired.set(key, now);
  const bucket = Math.floor(now / GAP_REPAIR_COOLDOWN_MS);
  void enqueue(
    "candle_gap_repair",
    { symbol, interval },
    { idempotencyKey: `repair:${key}:${bucket}` },
  ).catch(() => {
    // Repair is best-effort; the cron sweep remains the backstop.
  });
}

export interface DataFreshness {
  lastCandleTime: number | null;
  ageMs: number | null;
  isFresh: boolean;
  reason?: string;
}

import { resolveCostEvidence, type CostEvidence } from "./costEvidence";

export interface AgentMarketContext {
  symbol: string;
  interval: string;
  higherInterval: string;
  currentPrice: number | null;
  /**
   * Observed spread in PRICE units, when a caller supplied one. Prefer
   * costEvidence: this field carries no unit in its name, which is how the
   * price/pips mismatch stayed latent.
   */
  spread: number | null;
  /**
   * The resolved cost evidence for this analysis. Built HERE because every
   * entry point — chat, MCP analyze, opportunity scan, re-evaluation — funnels
   * through this builder, so wiring it once wires all of them.
   */
  costEvidence: CostEvidence;
  atr: number | null;
  marketRegime: ReturnType<typeof detectMarketRegime>;
  dataQuality: {
    currentTfCount: number;
    higherTfCount: number;
    dailyCount: number;
    sufficient: boolean;
    hasCriticalGaps: boolean;
    coverage: CandleCoverageReport;
    policyVersion: string;
  };
  freshness: DataFreshness;
  sync: MarketSyncStatus;
  marketOpen: boolean;
  currentTfCandles: AgentCandle[];
  higherTfCandles: AgentCandle[];
  dailyCandles: AgentCandle[];
  visibleCandles: AgentCandle[];
  majorLevels: ReturnType<typeof detectMajorLevels>;
  liquidity: ReturnType<typeof detectLiquidity>;
  zones: ReturnType<typeof detectSupplyDemandZones>;
}

async function refillIfThin(input: {
  symbol: string;
  interval: string;
  available: number;
  required: number;
  limit: number;
}): Promise<{ attempted: boolean; inserted: number; failed: boolean }> {
  if (input.available >= input.required) {
    return { attempted: false, inserted: 0, failed: false };
  }
  const result = await backfillCandles({
    symbol: input.symbol,
    interval: input.interval,
    limit: input.limit,
  });
  return {
    attempted: true,
    inserted: result.inserted,
    failed: Boolean(
      result.reason === "provider_error" || result.reason === "no_account",
    ),
  };
}

export async function buildAgentMarketContext(input: {
  userId?: number;
  symbol: string;
  interval: string;
  visibleRange?: { from: number; to: number };
  latestCandle?: AgentChartContext["latestCandle"];
  dataSource?: AgentChartContext["dataSource"];
  spread?: number | null;
  /** A bid/ask the caller already holds — replayed moments, worker paths. */
  observedQuote?: { bid: number; ask: number; observedAt?: number } | null;
  analysisKind?: CoverageAnalysisKind;
}): Promise<AgentMarketContext> {
  const symbol = forexCanonicalKey(input.symbol);
  const interval = normalizeCanonicalInterval(input.interval);
  const higherInterval = getHigherInterval(interval);
  const analysisKind = input.analysisKind ?? "intraday";
  const source = "warehouse+metaapi";

  let fresh = await getFreshAgentCandles({
    userId: input.userId,
    symbol,
    interval,
    dataSource: input.dataSource,
    limit: 1500,
  });

  let [higherTfCandles, dailyCandles, visibleCandles] = await Promise.all([
    getCandles({ symbol, interval: higherInterval, limit: 1000 }),
    getCandles({ symbol, interval: "1d", limit: 500 }),
    input.visibleRange
      ? getCandles({
          symbol,
          interval,
          fromMs: input.visibleRange.from,
          toMs: input.visibleRange.to,
          limit: 2000,
        })
      : Promise.resolve([] as AgentCandle[]),
  ]);
  let currentTfCandles = fresh.currentTfCandles;

  // Bounded synchronous refill when any series is below the TRADE gate.
  // Chart viewport alone is never enough for trade/drawing analysis.
  const tradeGate = DATA_QUALITY_POLICY.trade;
  const [currentRefill, higherRefill, dailyRefill] = await Promise.all([
    refillIfThin({
      symbol,
      interval,
      available: currentTfCandles.length,
      required: tradeGate.currentTf,
      limit: 5000,
    }),
    refillIfThin({
      symbol,
      interval: higherInterval,
      available: higherTfCandles.length,
      required: tradeGate.higherTf,
      limit: 2000,
    }),
    refillIfThin({
      symbol,
      interval: "1d",
      available: dailyCandles.length,
      required: tradeGate.daily,
      limit: 500,
    }),
  ]);

  if (currentRefill.attempted || higherRefill.attempted || dailyRefill.attempted) {
    if (currentRefill.inserted > 0) {
      fresh = await getFreshAgentCandles({
        userId: input.userId,
        symbol,
        interval,
        dataSource: input.dataSource,
        limit: 1500,
      });
      currentTfCandles = fresh.currentTfCandles;
    }
    [higherTfCandles, dailyCandles] = await Promise.all([
      getCandles({ symbol, interval: higherInterval, limit: 1000 }),
      getCandles({ symbol, interval: "1d", limit: 500 }),
    ]);
  }

  // Background top-up beyond the sync refill (never blocks).
  if (currentTfCandles.length < tradeGate.currentTf) {
    triggerBackfill({ symbol, interval, limit: 5000 });
  }
  if (higherTfCandles.length < tradeGate.higherTf) {
    triggerBackfill({ symbol, interval: higherInterval, limit: 2000 });
  }
  if (dailyCandles.length < tradeGate.daily) {
    triggerBackfill({ symbol, interval: "1d", limit: 500 });
  }

  // Gap checks are scoped to the recent windows that can influence a trade
  // decision. detectCandleGaps already excludes the normal Forex weekend.
  const gaps = {
    current: detectCandleGaps(
      symbol,
      interval,
      currentTfCandles.slice(-tradeGate.currentTf),
    ),
    higher: detectCandleGaps(
      symbol,
      higherInterval,
      higherTfCandles.slice(-tradeGate.higherTf),
    ),
    daily: detectCandleGaps(
      symbol,
      "1d",
      dailyCandles.slice(-tradeGate.daily),
    ),
  };

  const coverage = buildCandleCoverageReport({
    analysisKind,
    gate: "trade",
    currentInterval: interval,
    higherInterval,
    currentTfCount: currentTfCandles.length,
    higherTfCount: higherTfCandles.length,
    dailyCount: dailyCandles.length,
    currentOldest: currentTfCandles[0]?.time ?? null,
    currentNewest: currentTfCandles.at(-1)?.time ?? null,
    higherOldest: higherTfCandles[0]?.time ?? null,
    higherNewest: higherTfCandles.at(-1)?.time ?? null,
    dailyOldest: dailyCandles[0]?.time ?? null,
    dailyNewest: dailyCandles.at(-1)?.time ?? null,
    source,
    gaps,
    refill: {
      current: currentRefill,
      higher: higherRefill,
      daily: dailyRefill,
    },
  });

  // Auto-repair: gaps at warning level or worse enqueue a bounded repair for
  // the affected series only. Never blocks — analysis proceeds below.
  for (const frame of coverage.timeframes) {
    if (frame.gapSeverity === "significant" || frame.gapSeverity === "catastrophic") {
      triggerGapRepair(symbol, frame.interval);
    }
  }

  const currentPrice = currentTfCandles.at(-1)?.close ?? null;
  const lastCandleTime = currentTfCandles.at(-1)?.time ?? null;
  const marketOpen = isForexMarketOpen(symbol);
  const ageMs = lastCandleTime != null ? Date.now() - lastCandleTime : null;
  const tolerance = candleFreshnessToleranceMs(interval);
  const isFresh =
    ageMs != null && ageMs <= tolerance
      ? true
      : // Stale but market closed (weekend) is acceptable.
        !marketOpen;
  const freshness: DataFreshness = {
    lastCandleTime,
    ageMs,
    isFresh,
    reason:
      ageMs == null
        ? "لا شموع مخزّنة"
        : isFresh
          ? undefined
          : marketOpen
            ? "الشموع متأخرة والسوق مفتوح"
            : "السوق مغلق — شموع قديمة مقبولة",
  };

  const atr = calculateAtr(currentTfCandles);
  // Resolved before the sync guard so every consumer sees the same object.
  const costEvidence = await resolveCostEvidence({
    userId: input.userId,
    symbol,
    referencePrice: currentPrice,
    observedOverride:
      input.observedQuote && input.observedQuote.bid > 0 && input.observedQuote.ask > 0
        ? input.observedQuote
        : null,
  });
  const sync = evaluateMarketSync({
    symbol,
    interval,
    warehouseCandles: currentTfCandles,
    liveCandles: fresh.liveCandles,
    chartLatestCandle: input.latestCandle,
    spread: input.spread,
    atr,
    liveError: fresh.liveError,
  });

  return {
    symbol,
    interval,
    higherInterval,
    currentPrice,
    // Falls back to the resolved cost evidence, in the SAME price units this
    // field has always carried. Every consumer — net R, the spread gate, the
    // execution guard — reads this, and every production caller left it null,
    // so expected cost was 0 and net R equalled gross R on every plan.
    spread: input.spread ?? costEvidence.spreadPrice,
    costEvidence,
    atr,
    marketRegime: detectMarketRegime(currentTfCandles),
    dataQuality: {
      currentTfCount: currentTfCandles.length,
      higherTfCount: higherTfCandles.length,
      dailyCount: dailyCandles.length,
      // "sufficient" = the ANALYSIS gate. Critical open-market gaps override
      // otherwise adequate row counts and stop downstream market analysis.
      sufficient: coverage.sufficientForAnalysis,
      hasCriticalGaps: coverage.hasCriticalGaps === true,
      coverage,
      policyVersion: CANDLE_COVERAGE_POLICY_VERSION,
    },
    freshness,
    sync,
    marketOpen,
    currentTfCandles,
    higherTfCandles,
    dailyCandles,
    visibleCandles,
    majorLevels: detectMajorLevels(currentTfCandles, dailyCandles),
    liquidity: detectLiquidity(currentTfCandles),
    zones: detectSupplyDemandZones(currentTfCandles),
  };
}
