import type { OhlcCandle } from "@/lib/ohlc/fetchOhlc";

/**
 * Shared pivot (swing point) extraction for the analysis layer. Pattern, level,
 * channel and trendline detectors all reason over the same ordered pivot list
 * instead of re-deriving swings each time.
 */
export interface Pivot {
  /** Index into the candle array. */
  index: number;
  price: number;
  kind: "high" | "low";
}

/** bars-ahead offset for a candle index, relative to the last candle (0 = now, negative = past). */
export function barsAheadFor(index: number, candleCount: number): number {
  return index - (candleCount - 1);
}

function isSwingHigh(candles: OhlcCandle[], i: number, lb: number): boolean {
  const h = candles[i]!.high;
  for (let j = i - lb; j <= i + lb; j++) {
    if (j === i || j < 0 || j >= candles.length) continue;
    if (candles[j]!.high >= h) return false;
  }
  return true;
}

function isSwingLow(candles: OhlcCandle[], i: number, lb: number): boolean {
  const l = candles[i]!.low;
  for (let j = i - lb; j <= i + lb; j++) {
    if (j === i || j < 0 || j >= candles.length) continue;
    if (candles[j]!.low <= l) return false;
  }
  return true;
}

/**
 * Ordered alternating pivots (zig-zag). Detects raw swing highs/lows with the
 * given lookback, then collapses consecutive same-kind pivots to the more
 * extreme one so the sequence strictly alternates high/low — the shape pattern
 * detectors expect.
 */
export function extractPivots(candles: OhlcCandle[], lookback = 2): Pivot[] {
  const raw: Pivot[] = [];
  for (let i = lookback; i < candles.length - lookback; i++) {
    if (isSwingHigh(candles, i, lookback)) {
      raw.push({ index: i, price: candles[i]!.high, kind: "high" });
    } else if (isSwingLow(candles, i, lookback)) {
      raw.push({ index: i, price: candles[i]!.low, kind: "low" });
    }
  }
  raw.sort((a, b) => a.index - b.index);

  const out: Pivot[] = [];
  for (const p of raw) {
    const last = out[out.length - 1];
    if (!last || last.kind !== p.kind) {
      out.push(p);
      continue;
    }
    // Same kind back-to-back — keep the more extreme one.
    if (p.kind === "high" ? p.price > last.price : p.price < last.price) {
      out[out.length - 1] = p;
    }
  }
  return out;
}

export function lastHighs(pivots: Pivot[], n: number): Pivot[] {
  return pivots.filter((p) => p.kind === "high").slice(-n);
}

export function lastLows(pivots: Pivot[], n: number): Pivot[] {
  return pivots.filter((p) => p.kind === "low").slice(-n);
}

/** Relative closeness test: |a-b| / ref <= tolPct. */
export function near(a: number, b: number, tolPct = 0.0015): boolean {
  const ref = Math.abs(b) > 1e-9 ? Math.abs(b) : 1;
  return Math.abs(a - b) / ref <= tolPct;
}
