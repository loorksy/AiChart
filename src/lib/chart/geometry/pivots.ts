/**
 * Pivot production — the input every pattern detector consumes.
 *
 * Resurrects the `Pivot[]` producer the drawing builders in
 * web/src/lib/analysis/drawings.ts lost when the old analysis pivots module
 * was gutted. Two stages:
 *
 *  1. `confirmedPivots` — fractal swing points confirmed by `lookback` bars on
 *     each side (generalised from trendlineEvidence.ts, lookback configurable).
 *  2. `zigzagPivots` — alternating high/low sequence where each leg moves at
 *     least `minMoveAtr × ATR`, so pattern templates see structure, not noise.
 */
import type { GeometryCandle, GeometryPivot } from "./types";

export const DEFAULT_PIVOT_LOOKBACK = 3;
export const DEFAULT_ZIGZAG_MIN_MOVE_ATR = 0.5;

/**
 * Fractal swing pivots for one side, confirmed by `lookback` bars each way.
 *
 * Plateau rule: equal extremes on the RIGHT are tolerated (so a flat double
 * low still yields a pivot) while an equal extreme on the LEFT disqualifies —
 * the FIRST bar of an equal run is the pivot, later duplicates defer to it.
 * A strictly more extreme bar on either side disqualifies as before.
 */
export function confirmedPivots(
  candles: readonly GeometryCandle[],
  side: "high" | "low",
  lookback = DEFAULT_PIVOT_LOOKBACK,
): GeometryPivot[] {
  const out: GeometryPivot[] = [];
  const lb = Math.max(1, Math.min(5, Math.floor(lookback)));
  for (let i = lb; i < candles.length - lb; i++) {
    const candle = candles[i]!;
    const price = side === "low" ? candle.low : candle.high;
    let ok = true;
    for (let j = 1; j <= lb; j++) {
      const left = side === "low" ? candles[i - j]!.low : candles[i - j]!.high;
      const right = side === "low" ? candles[i + j]!.low : candles[i + j]!.high;
      if (side === "low") {
        // Left equal-or-lower fails (keep first of a run); right strictly
        // lower fails, right equal passes (plateau edge).
        if (left <= price || right < price) {
          ok = false;
          break;
        }
      } else if (left >= price || right > price) {
        ok = false;
        break;
      }
    }
    if (ok) {
      out.push({ index: i, time: candle.time, price, kind: side });
    }
  }
  return out;
}

/** Both sides merged chronologically (index order; highs before lows on ties). */
export function allConfirmedPivots(
  candles: readonly GeometryCandle[],
  lookback = DEFAULT_PIVOT_LOOKBACK,
): GeometryPivot[] {
  const merged = [
    ...confirmedPivots(candles, "high", lookback),
    ...confirmedPivots(candles, "low", lookback),
  ];
  merged.sort((a, b) => a.index - b.index || (a.kind === "high" ? -1 : 1));
  return merged;
}

/**
 * Alternating zigzag over confirmed pivots.
 *
 * Consecutive same-kind pivots collapse to the more extreme one; a direction
 * change is accepted only when the leg moves at least `minMoveAtr × ATR`.
 * Guarantees strict high/low alternation — what H&S / double-top / flag
 * templates are written against.
 */
export function zigzagPivots(
  candles: readonly GeometryCandle[],
  atr: number,
  options: { lookback?: number; minMoveAtr?: number } = {},
): GeometryPivot[] {
  const minMove =
    Math.max(0.1, options.minMoveAtr ?? DEFAULT_ZIGZAG_MIN_MOVE_ATR) *
    Math.max(atr, Number.EPSILON);
  const raw = allConfirmedPivots(candles, options.lookback);
  if (raw.length === 0) return [];

  const out: GeometryPivot[] = [];
  for (const pivot of raw) {
    const last = out[out.length - 1];
    if (!last) {
      out.push(pivot);
      continue;
    }
    if (pivot.kind === last.kind) {
      // Same side: keep the more extreme point.
      const moreExtreme =
        pivot.kind === "high" ? pivot.price > last.price : pivot.price < last.price;
      if (moreExtreme) out[out.length - 1] = pivot;
      continue;
    }
    // Direction change: only meaningful legs survive.
    if (Math.abs(pivot.price - last.price) < minMove) continue;
    out.push(pivot);
  }
  return out;
}

/** Simple ATR over the window (mean true range, period 14). */
export function geometryAtr(candles: readonly GeometryCandle[], period = 14): number {
  if (candles.length < 2) return 0;
  const window = candles.slice(-Math.max(period * 4, 56));
  const trs: number[] = [];
  for (let i = 1; i < window.length; i++) {
    const c = window[i]!;
    const prev = window[i - 1]!;
    trs.push(
      Math.max(
        c.high - c.low,
        Math.abs(c.high - prev.close),
        Math.abs(c.low - prev.close),
      ),
    );
  }
  if (!trs.length) return 0;
  const tail = trs.slice(-period);
  return tail.reduce((a, b) => a + b, 0) / tail.length;
}
