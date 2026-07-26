/**
 * Dealing-range positioning: where the current price sits inside the recent
 * high↔low range (premium / discount / equilibrium / near extremes).
 *
 * How the decision engine uses it:
 * - Buys are preferred from DISCOUNT, sells from PREMIUM.
 * - Mid-range (equilibrium) is a poor IMMEDIATE entry, not an absent
 *   opportunity: the plan usually becomes conditional at a range edge, at the
 *   expected break, or after a liquidity sweep. Position is evidence that
 *   shapes the plan type — it never removes the direction.
 */
import type { AgentCandle } from "./detectors";

export type RangePositionLabel =
  | "premium"
  | "discount"
  | "mid_range"
  | "near_high"
  | "near_low"
  | "unknown";

export interface RangePosition {
  rangeHigh: number;
  rangeLow: number;
  rangeHighTime: number;
  rangeLowTime: number;
  equilibrium: number;
  /** 0 = range low, 1 = range high. */
  positionPct: number;
  label: RangePositionLabel;
}

const DEFAULT_LOOKBACK = 120;

export function computeRangePosition(
  candles: AgentCandle[],
  currentPrice: number | null,
  lookback = DEFAULT_LOOKBACK,
): RangePosition | null {
  if (!candles.length || currentPrice == null || !Number.isFinite(currentPrice)) {
    return null;
  }
  const window = candles.slice(-lookback);
  if (window.length < 20) return null;

  let rangeHigh = Number.NEGATIVE_INFINITY;
  let rangeLow = Number.POSITIVE_INFINITY;
  let rangeHighTime = window[0]!.time;
  let rangeLowTime = window[0]!.time;
  for (const c of window) {
    if (c.high > rangeHigh) {
      rangeHigh = c.high;
      rangeHighTime = c.time;
    }
    if (c.low < rangeLow) {
      rangeLow = c.low;
      rangeLowTime = c.time;
    }
  }
  const span = rangeHigh - rangeLow;
  if (!(span > 0)) return null;

  const positionPct = clamp01((currentPrice - rangeLow) / span);
  return {
    rangeHigh,
    rangeLow,
    rangeHighTime,
    rangeLowTime,
    equilibrium: rangeLow + span / 2,
    positionPct,
    label: labelFor(positionPct),
  };
}

function labelFor(p: number): RangePositionLabel {
  if (p >= 0.95) return "near_high";
  if (p <= 0.05) return "near_low";
  if (p >= 0.62) return "premium";
  if (p <= 0.38) return "discount";
  return "mid_range";
}

/**
 * True when this range position disfavors an immediate entry in that direction.
 * Evidence for the plan type — buying a premium usually wants a pullback or a
 * confirmed break first — never a reason to withhold the direction itself.
 */
export function positionDisfavorsAction(
  label: RangePositionLabel,
  action: "buy" | "sell",
): boolean {
  if (label === "mid_range") return true;
  if (action === "buy") return label === "premium" || label === "near_high";
  return label === "discount" || label === "near_low";
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}
