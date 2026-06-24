/** Normalize candle open time to Lightweight Charts UTCTimestamp (seconds). */
export function toChartSeconds(time: number): number {
  if (!Number.isFinite(time) || time <= 0) return 0;
  // Binance openTime is ms; MT5/EA typically Unix seconds.
  return time > 1e12 ? Math.floor(time / 1000) : Math.floor(time);
}

export type ChartMarket = "crypto" | "forex";

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
}

/**
 * Drops corrupt / cross-market bars (e.g. ETH ~1600 leaking onto EUR/USD ~1.14).
 */
export function sanitizeCandlesForMarket<
  T extends { time: number; open: number; high: number; low: number; close: number },
>(candles: T[], market: ChartMarket): T[] {
  const normalized = normalizeCandlesForChart(candles);
  if (normalized.length === 0) return [];

  const closes = normalized.map((c) => c.close).filter((v) => v > 0);
  const med = median(closes);

  return normalized.filter((c) => {
    const ohlc = [c.open, c.high, c.low, c.close];
    if (ohlc.some((p) => !Number.isFinite(p) || p <= 0)) return false;
    if (market === "forex") {
      if (ohlc.some((p) => p > 1_000_000 || p < 0.000_01)) return false;
      if (med > 0 && med < 10_000) {
        const max = med * 25;
        const min = med / 25;
        if (ohlc.some((p) => p < min || p > max)) return false;
      }
    }
    if (c.high < c.low) return false;
    if (c.high < Math.max(c.open, c.close) || c.low > Math.min(c.open, c.close)) {
      return false;
    }
    return true;
  });
}

/** Reject live ticks that would corrupt the last bar (wrong market / stale feed). */
export function livePriceConsistent(
  refClose: number,
  live: number,
  market: ChartMarket,
): boolean {
  if (!(refClose > 0) || !(live > 0)) return false;
  const ratio = live / refClose;
  const band = market === "forex" ? 0.08 : 0.25;
  return ratio >= 1 - band && ratio <= 1 + band;
}

export function normalizeCandlesForChart<
  T extends { time: number; open: number; high: number; low: number; close: number },
>(candles: T[]): Array<T & { time: number }> {
  return candles
    .map((c) => ({
      ...c,
      time: toChartSeconds(c.time),
      open: Number(c.open),
      high: Number(c.high),
      low: Number(c.low),
      close: Number(c.close),
    }))
    .filter((c) => c.time > 0)
    .sort((a, b) => a.time - b.time);
}
