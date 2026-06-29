/** Normalize candle open time to Lightweight Charts UTCTimestamp (seconds). */
export function toChartSeconds(time: number): number {
  if (!Number.isFinite(time) || time <= 0) return 0;
  // Binance openTime is ms; MT5/EA typically Unix seconds.
  return time > 1e12 ? Math.floor(time / 1000) : Math.floor(time);
}

export type ChartMarket = "crypto" | "forex";

/** Order of magnitude of a positive price (e.g. 1.135→0, 1615→3). */
function magnitudeBucket(price: number): number {
  return Math.floor(Math.log10(price));
}

/**
 * Drops corrupt / cross-market bars (e.g. ETH ~1600 leaking onto EUR/USD ~1.14).
 *
 * For forex we can't rely on the median as an anchor: when a large share of the
 * feed is corrupt the median lands between the two scales and the wrong bars
 * survive. Instead we cluster bars by price order-of-magnitude and keep the
 * dominant cluster (ties favour the smaller magnitude, since stray crypto/index
 * intruders are the larger values).
 */
export function sanitizeCandlesForMarket<
  T extends { time: number; open: number; high: number; low: number; close: number },
>(candles: T[], market: ChartMarket): T[] {
  const normalized = normalizeCandlesForChart(candles);
  if (normalized.length === 0) return [];

  // Structurally valid, positive bars (both markets).
  const structurallyValid = normalized.filter((c) => {
    const ohlc = [c.open, c.high, c.low, c.close];
    if (ohlc.some((p) => !Number.isFinite(p) || p <= 0)) return false;
    if (c.high < c.low) return false;
    if (c.high < Math.max(c.open, c.close) || c.low > Math.min(c.open, c.close)) {
      return false;
    }
    return true;
  });

  if (market !== "forex" || structurallyValid.length === 0) return structurallyValid;

  // Forex: hard sanity bounds, then keep only the dominant magnitude cluster.
  const inBounds = structurallyValid.filter(
    (c) => ![c.open, c.high, c.low, c.close].some((p) => p > 1_000_000 || p < 0.000_01),
  );
  if (inBounds.length === 0) return [];

  const counts = new Map<number, number>();
  for (const c of inBounds) {
    const b = magnitudeBucket(c.close);
    counts.set(b, (counts.get(b) ?? 0) + 1);
  }
  let dominant = Infinity;
  let best = -1;
  for (const [bucket, count] of counts) {
    if (count > best || (count === best && bucket < dominant)) {
      best = count;
      dominant = bucket;
    }
  }

  return inBounds.filter((c) => magnitudeBucket(c.close) === dominant);
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
