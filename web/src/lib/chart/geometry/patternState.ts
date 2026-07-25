/**
 * Shared forming → completed → invalidated state machine.
 *
 * Every detector reports state through these helpers so "completed" always
 * means the same thing: a CLOSE beyond the boundary with the same 0.25×ATR
 * buffer convention `trendlineEvidence.isBroken` established. Wicks never
 * complete a pattern (a wick through a level is a sweep, not a break).
 */
import type { GeometryCandle, PatternStatus } from "./types";

export const BREAK_BUFFER_ATR = 0.25;

export interface BreakoutCheck {
  status: "none" | "broken";
  /** Index of the breaking candle when status is "broken". */
  breakIndex?: number;
  breakClose?: number;
}

/**
 * First candle AFTER `fromIndex` whose CLOSE crosses `levelAt(index)` in
 * `direction` by more than the buffer.
 */
export function firstCloseBeyond(
  candles: readonly GeometryCandle[],
  fromIndex: number,
  levelAt: (index: number) => number,
  direction: "up" | "down",
  atr: number,
  buffer = BREAK_BUFFER_ATR,
): BreakoutCheck {
  const tol = Math.max(atr * buffer, Number.EPSILON);
  for (let i = Math.max(0, fromIndex + 1); i < candles.length; i++) {
    const close = candles[i]!.close;
    const level = levelAt(i);
    if (!Number.isFinite(level)) continue;
    if (direction === "up" && close > level + tol) {
      return { status: "broken", breakIndex: i, breakClose: close };
    }
    if (direction === "down" && close < level - tol) {
      return { status: "broken", breakIndex: i, breakClose: close };
    }
  }
  return { status: "none" };
}

/**
 * Resolve a two-boundary pattern (triangle/wedge/flag body): completed when
 * price closes out of one boundary, invalidated when it closes out of the
 * other, forming while it stays inside and `formingValid` holds.
 */
export function resolveBoundedPattern(input: {
  candles: readonly GeometryCandle[];
  fromIndex: number;
  upperAt: (index: number) => number;
  lowerAt: (index: number) => number;
  atr: number;
  completeDirection: "up" | "down" | "either";
  /** Forming stays valid only while this predicate holds (e.g. apex distance). */
  formingValid?: boolean;
}): { status: PatternStatus; breakIndex?: number; breakDirection?: "up" | "down" } {
  const up = firstCloseBeyond(
    input.candles,
    input.fromIndex,
    input.upperAt,
    "up",
    input.atr,
  );
  const down = firstCloseBeyond(
    input.candles,
    input.fromIndex,
    input.lowerAt,
    "down",
    input.atr,
  );

  const first: { direction: "up" | "down"; index: number } | null =
    up.status === "broken" && down.status === "broken"
      ? up.breakIndex! <= down.breakIndex!
        ? { direction: "up", index: up.breakIndex! }
        : { direction: "down", index: down.breakIndex! }
      : up.status === "broken"
        ? { direction: "up", index: up.breakIndex! }
        : down.status === "broken"
          ? { direction: "down", index: down.breakIndex! }
          : null;

  if (first) {
    if (input.completeDirection === "either" || first.direction === input.completeDirection) {
      return { status: "completed", breakIndex: first.index, breakDirection: first.direction };
    }
    return { status: "invalidated", breakIndex: first.index, breakDirection: first.direction };
  }
  return { status: input.formingValid === false ? "invalidated" : "forming" };
}

/** Measured-move target: break level ± pattern height. */
export function projectMeasuredMove(
  breakLevel: number,
  height: number,
  direction: "up" | "down",
): number {
  const magnitude = Math.abs(height);
  return direction === "up" ? breakLevel + magnitude : breakLevel - magnitude;
}

/** Confidence discount per state — forming evidence is weaker by contract. */
export function stateConfidence(base: number, status: PatternStatus): number {
  if (status === "completed") return base;
  if (status === "forming") return Math.round(base * 0.85);
  return Math.round(base * 0.4);
}
