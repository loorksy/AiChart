/**
 * Builds the multi-timeframe market context the specialist agents reason on.
 * Every series — current TF, higher TF, daily, and the chart's visible range
 * — is pulled live off the user's linked MetaTrader account, every call.
 * There is no persistent warehouse behind any of it and no synchronous
 * refill: `fetchOhlc` either returns what the broker has, or it doesn't, and
 * the coverage report below says exactly which.
 */
import { fetchOhlc } from "@/lib/ohlc/fetchOhlc";
import { detectCandleGaps } from "@/lib/ohlc/candleGaps";
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

export interface DataFreshness {
  lastCandleTime: number | null;
  ageMs: number | null;
  isFresh: boolean;
  reason?: string;
}

import { resolveCostEvidence, type CostEvidence } from "./costEvidence";
import { getForexLiveQuote } from "@/lib/markets/forexPrice";

/**
 * How long the builder will wait for a live bid/ask before analysing without
 * one. Short on purpose: the quote upgrades the cost evidence to rung 1
 * (observed_quote), but a slow broker RPC must never stall the market-data
 * stage — past the deadline the ladder simply resolves from its lower rungs.
 */
const LIVE_QUOTE_TIMEOUT_MS = 1_800;

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
  const source = "metaapi";
  const userId = input.userId ?? 0;

  // Rung 1 of the cost ladder needs a real bid/ask, and no production entry
  // point ever supplied one — which is how the platform showed a live spread
  // in its ticker while telling the decision engine the spread was
  // unavailable. When the caller did not hand us a quote (or a spread), fetch
  // one from the operator's own broker feed — the same call the forex-price
  // ticker route makes — bounded and started HERE so it overlaps the candle
  // I/O below. Failure degrades silently to the ladder's lower rungs.
  const callerQuote =
    input.observedQuote && input.observedQuote.bid > 0 && input.observedQuote.ask > 0
      ? input.observedQuote
      : null;
  const liveQuotePromise: Promise<{
    bid: number;
    ask: number;
    observedAt?: number;
  } | null> =
    callerQuote == null && input.spread == null && input.userId
      ? getForexLiveQuote(input.userId, symbol, {
          timeoutMs: LIVE_QUOTE_TIMEOUT_MS,
        }).catch(() => null)
      : Promise.resolve(null);

  const fresh = await getFreshAgentCandles({
    userId: input.userId,
    symbol,
    interval,
    dataSource: input.dataSource,
    limit: 1500,
  });
  const currentTfCandles = fresh.currentTfCandles;

  const [higherTfCandles, dailyCandles, visibleCandles] = await Promise.all([
    fetchOhlc({ userId, symbol, interval: higherInterval, limit: 1000, skipCache: true })
      .then((r) => r.candles as AgentCandle[]),
    fetchOhlc({ userId, symbol, interval: "1d", limit: 500, skipCache: true })
      .then((r) => r.candles as AgentCandle[]),
    input.visibleRange
      ? fetchOhlc({
          userId,
          symbol,
          interval,
          fromMs: input.visibleRange.from,
          toMs: input.visibleRange.to,
          skipCache: true,
        }).then((r) => r.candles as AgentCandle[])
      : Promise.resolve([] as AgentCandle[]),
  ]);

  // Gap checks are scoped to the recent windows that can influence a trade
  // decision. detectCandleGaps already excludes the normal Forex weekend.
  const tradeGate = DATA_QUALITY_POLICY.trade;
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
  // Resolved before the sync guard so every consumer sees the same object.
  // The caller's own quote wins; otherwise the live fetch started above has
  // had the whole candle phase to answer inside its own timeout.
  const costEvidence = await resolveCostEvidence({
    userId: input.userId,
    symbol,
    referencePrice: currentPrice,
    observedOverride: callerQuote ?? (await liveQuotePromise),
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
