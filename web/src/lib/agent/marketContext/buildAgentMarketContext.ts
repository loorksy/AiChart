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
import { getCandles } from "@/lib/candles/candleRepository";
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
  meetsDataQuality,
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

export interface DataFreshness {
  lastCandleTime: number | null;
  ageMs: number | null;
  isFresh: boolean;
  reason?: string;
}

export interface AgentMarketContext {
  symbol: string;
  interval: string;
  higherInterval: string;
  currentPrice: number | null;
  spread: number | null;
  atr: number | null;
  marketRegime: ReturnType<typeof detectMarketRegime>;
  dataQuality: {
    currentTfCount: number;
    higherTfCount: number;
    dailyCount: number;
    sufficient: boolean;
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
    failed: Boolean(result.reason === "oanda_error"),
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
  analysisKind?: CoverageAnalysisKind;
}): Promise<AgentMarketContext> {
  const symbol = forexCanonicalKey(input.symbol);
  const interval = normalizeCanonicalInterval(input.interval);
  const higherInterval = getHigherInterval(interval);
  const analysisKind = input.analysisKind ?? "intraday";
  const source =
    input.dataSource === "ea" ? "ea+warehouse" : "warehouse+oanda";

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
    refill: {
      current: currentRefill,
      higher: higherRefill,
      daily: dailyRefill,
    },
  });

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
    spread: input.spread ?? null,
    atr,
    marketRegime: detectMarketRegime(currentTfCandles),
    dataQuality: {
      currentTfCount: currentTfCandles.length,
      higherTfCount: higherTfCandles.length,
      dailyCount: dailyCandles.length,
      // "sufficient" = the ANALYSIS gate; trade/drawing gates are stricter and
      // enforced by the playbook + drawing plan via the same central policy.
      sufficient: meetsDataQuality(
        {
          currentTfCount: currentTfCandles.length,
          higherTfCount: higherTfCandles.length,
          dailyCount: dailyCandles.length,
        },
        "analysis",
      ),
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
