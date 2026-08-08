/**
 * Assembles the OHLC bars payload for the Quant Agent Service (§2 — web
 * gathers candles from the SAME pipe every other agent surface uses, then
 * pushes them; the service itself makes zero outbound calls). This reuses
 * `fetchOhlc` / `resolveMarketDataSource` exactly as `/api/agent/market/ohlc`
 * does — it does not open a new data-fetching path.
 */
import { DEFAULT_MARKET, rejectNonForexMarket, resolveActiveMarket } from "@/lib/marketPolicy";
import { normalizeInterval } from "@/lib/intervals";
import type { MarketType } from "@/lib/markets/types";
import { resolveMarketDataSource } from "@/lib/markets/marketDataSource";
import { fetchOhlc, OHLC_MAX_LIMIT } from "@/lib/ohlc/fetchOhlc";
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
