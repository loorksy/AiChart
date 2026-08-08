/**
 * Assembles the OHLC bars payload for the Quant Agent Service (§2 — web
 * gathers candles from the SAME pipe every other agent surface uses, then
 * pushes them; the service itself makes zero outbound calls). This reuses
 * `fetchOhlc` / `resolveMarketDataSource` exactly as `/api/agent/market/ohlc`
 * does — it does not open a new data-fetching path.
 *
 * This file also exposes `fetchQuantAgentAnalysisBars`, a second, ANALYSIS-
 * ONLY candle path with no `userId`/linked-account concept at all — it backs
 * the unattended cron scan/monitor sweeps (plan §4: "لا مبرر منطقي لربط تكة
 * cron غير مأهولة بحساب MT لمشغّل واحد بعينه") and is safe to import here
 * because this file is NOT on `analysisIsolation.test.ts`'s protected list.
 * It delegates the actual "warehouse, then live" read to
 * `@/lib/markets/analysisCandleFeed` — shared with the analysis-only MCP
 * bridge routes so there is exactly one implementation of that read shape,
 * not two copies drifting apart. `analysisCandleFeed.ts` is itself the file
 * that imports `analysisCandleRepository.ts`/`markets/oanda.ts` — this file
 * only imports it, not either of those two directly.
 */
import { DEFAULT_MARKET, rejectNonForexMarket, resolveActiveMarket } from "@/lib/marketPolicy";
import { normalizeInterval } from "@/lib/intervals";
import type { MarketType } from "@/lib/markets/types";
import { resolveMarketDataSource } from "@/lib/markets/marketDataSource";
import { fetchOhlc, OHLC_MAX_LIMIT } from "@/lib/ohlc/fetchOhlc";
import { fetchAnalysisCandleFeed } from "@/lib/markets/analysisCandleFeed";
import type { QuantOhlcBar } from "./types";

/** Enough history for EMA200/ADX14/Bollinger warmup without an oversized payload. */
export const QUANT_AGENT_DEFAULT_BAR_LIMIT = 300;

export interface FetchQuantAgentBarsOptions {
  userId: number;
  symbol: string;
  interval?: string;
  market?: string;
  limit?: number;
}

export interface QuantAgentBarsResult {
  symbol: string;
  market: MarketType;
  interval: string;
  bars: QuantOhlcBar[];
  warning?: string;
}

export class QuantAgentMarketFeedError extends Error {}

export async function fetchQuantAgentBars(
  options: FetchQuantAgentBarsOptions,
): Promise<QuantAgentBarsResult> {
  const rawMarket = options.market ?? DEFAULT_MARKET;
  const marketErr = rejectNonForexMarket(rawMarket);
  if (marketErr) throw new QuantAgentMarketFeedError(marketErr);
  const market = resolveActiveMarket(rawMarket);
  const interval = normalizeInterval(options.interval ?? "1h");
  const limit = Math.min(Math.max(1, options.limit ?? QUANT_AGENT_DEFAULT_BAR_LIMIT), OHLC_MAX_LIMIT);

  const decision = await resolveMarketDataSource(options.userId, null);

  // An unlinked chat user gets SOME analysis instead of nothing — the
  // account-linked path below still runs (and still wins) whenever a link
  // exists; this only fires when there is genuinely no MT account to read.
  if (decision.reason === "metaapi_not_connected") {
    const fallback = await fetchQuantAgentAnalysisBars({
      symbol: options.symbol,
      interval,
      market,
      limit,
    });
    if (fallback.bars.length) return fallback;
  }

  const fetched = await fetchOhlc({
    userId: options.userId,
    symbol: options.symbol,
    interval,
    market,
    source: decision.source,
    limit,
  });

  const bars: QuantOhlcBar[] = fetched.candles.map((candle) => ({
    time: candle.time,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    ...(candle.volume != null ? { volume: candle.volume } : {}),
  }));

  return {
    symbol: fetched.symbol,
    market,
    interval: fetched.interval,
    bars,
    warning: fetched.warning,
  };
}

export interface FetchQuantAgentAnalysisBarsOptions {
  symbol: string;
  interval?: string;
  market?: string;
  limit?: number;
}

/**
 * Analysis-only candle feed — NO `userId`, because there is no per-user
 * concept on this data path (plan §4). Backs the Quant Agent's unattended
 * cron scan/monitor sweeps so they stop borrowing one operator's linked MT
 * account for candles that belong to nobody in particular.
 */
export async function fetchQuantAgentAnalysisBars(
  options: FetchQuantAgentAnalysisBarsOptions,
): Promise<QuantAgentBarsResult> {
  const rawMarket = options.market ?? DEFAULT_MARKET;
  const marketErr = rejectNonForexMarket(rawMarket);
  if (marketErr) throw new QuantAgentMarketFeedError(marketErr);
  const market = resolveActiveMarket(rawMarket);
  const interval = normalizeInterval(options.interval ?? "1h");
  const limit = Math.min(Math.max(1, options.limit ?? QUANT_AGENT_DEFAULT_BAR_LIMIT), OHLC_MAX_LIMIT);

  const fed = await fetchAnalysisCandleFeed(options.symbol, interval, limit);

  const bars: QuantOhlcBar[] = fed.candles.map((candle) => ({
    time: candle.time,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    ...(candle.volume != null ? { volume: candle.volume } : {}),
  }));

  return { symbol: fed.symbol, market, interval: fed.interval, bars, warning: fed.warning };
}
