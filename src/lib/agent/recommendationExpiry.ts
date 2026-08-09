/**
 * Pure recommendation lifetime helpers — safe for client bundles.
 * Keep this file free of store/DB imports.
 */

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
