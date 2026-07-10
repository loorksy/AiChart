/**
 * Builds the multi-timeframe market context the specialist agents reason on.
 * Candles come from the warehouse (current TF, higher TF, daily) so the agent
 * sees hundreds–thousands of bars, not the ~120 the legacy analyze path used.
 * Thin coverage triggers a background backfill and is reported via dataQuality.
 */
import { getCandles } from "@/lib/candles/candleRepository";
import { triggerBackfill } from "@/lib/candles/candleBackfillService";
import {
  getHigherInterval,
  normalizeCanonicalInterval,
  candleFreshnessToleranceMs,
} from "@/lib/markets/intervals";
import { forexCanonicalKey } from "@/lib/markets/forexCanonical";
import { isForexMarketOpen } from "@/lib/agent/marketSession";
import {
  DATA_QUALITY_POLICY,
  meetsDataQuality,
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
}): Promise<AgentMarketContext> {
  const symbol = forexCanonicalKey(input.symbol);
  const interval = normalizeCanonicalInterval(input.interval);
  const higherInterval = getHigherInterval(interval);

  const fresh = await getFreshAgentCandles({
    userId: input.userId,
    symbol,
    interval,
    dataSource: input.dataSource,
    limit: 1500,
  });

  const [higherTfCandles, dailyCandles, visibleCandles] =
    await Promise.all([
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
  const currentTfCandles = fresh.currentTfCandles;

  // Thin coverage → background top-up (never blocks this request). Uses the
  // TRADE gate so drawing/trade thresholds are proactively satisfied.
  if (currentTfCandles.length < DATA_QUALITY_POLICY.trade.currentTf) {
    triggerBackfill({ symbol, interval, limit: 5000 });
  }
  if (higherTfCandles.length < DATA_QUALITY_POLICY.trade.higherTf) {
    triggerBackfill({ symbol, interval: higherInterval, limit: 2000 });
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
