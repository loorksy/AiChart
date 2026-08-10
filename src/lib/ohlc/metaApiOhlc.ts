import { barDurationMs, normalizeInterval } from "@/lib/intervals";

/**
 * Whether a candle is closed — pure arithmetic, source-agnostic: a bar whose
 * window has fully elapsed is closed; only the newest bar can still be
 * forming. Kept here (rather than moved) so its existing importers
 * (recommendation route, recommendationTracker, orchestrator) don't need
 * touching; the MetaApi-specific candle-fetch functions that used to share
 * this file were retired with the OANDA market-data migration — candles now
 * come exclusively from markets/oanda.ts via ohlc/fetchOhlc.ts.
 */
export function isCandleComplete(
  openTimeMs: number,
  interval: string,
  nowMs = Date.now(),
): boolean {
  return openTimeMs + barDurationMs(normalizeInterval(interval)) <= nowMs;
}
