/** Normalize candle open time to Lightweight Charts UTCTimestamp (seconds). */
export function toChartSeconds(time: number): number {
  if (!Number.isFinite(time) || time <= 0) return 0;
  // Binance openTime is ms; MT5/EA typically Unix seconds.
  return time > 1e12 ? Math.floor(time / 1000) : Math.floor(time);
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
