/**
 * Pure recommendation lifetime helpers — safe for client bundles.
 * Keep this file free of store/DB imports.
 */
import { isMarketOpenAt, nextMarketOpenAt } from "@/lib/markets/tradingCalendar";

/**
 * The instant a recommendation's validity clock starts.
 *
 * Mid-session that is now. On a CLOSED market it is the next open: a plan
 * issued Saturday is a scenario for Monday, and counting its 6 candles of
 * validity from Saturday afternoon meant every weekend plan was already
 * expired ~46 hours before the first candle it could possibly be judged on
 * had printed — the cron sweep then dutifully marked it expired on Saturday
 * night. Anchoring here, at creation, is the whole fix: the sweeps stay
 * untouched, so a plan whose clock genuinely ran out on Friday still expires
 * on Saturday's tick exactly as it should.
 */
export function recommendationClockAnchor(symbol: string, nowMs: number): number {
  return isMarketOpenAt(symbol, nowMs) ? nowMs : nextMarketOpenAt(symbol, nowMs);
}

/**
 * Recommendation lifetime by timeframe/style. Scalps expire fast; higher
 * timeframes get days. Returns an absolute epoch-ms deadline from `from`.
 */
export function computeRecommendationExpiry(input: {
  interval: string;
  scalp?: boolean;
  from?: number;
}): number {
  const from = input.from ?? Date.now();
  const MIN = 60_000;
  const HOUR = 60 * MIN;
  const iv = (input.interval ?? "").toLowerCase().trim();
  if (input.scalp) return from + 30 * MIN;
  if (iv === "1m" || iv === "5m") return from + 45 * MIN;
  if (iv === "15m" || iv === "30m") return from + 3 * HOUR;
  if (iv === "1h" || iv === "4h") return from + 36 * HOUR;
  if (iv === "1d" || iv === "1w") return from + 7 * 24 * HOUR;
  // Unknown timeframe → a conservative intraday default.
  return from + 4 * HOUR;
}
