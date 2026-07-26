/**
 * Triple tops / triple bottoms.
 *
 * Three same-side extremes on one level with two intervening counter-pivots.
 * The third rejection is the information: a level defended twice might be
 * coincidence, a level defended three times is a decision by the market — which
 * is also why the neckline break, when it comes, tends to travel.
 *
 * The neckline is the HIGHER of the two counter-pivots for a top (the lower for
 * a bottom): the conservative line, so completion is not declared off the
 * shallower pullback.
 */
import type {
  GeometryDetectorInput,
  GeometryPivot,
  PatternInstance,
} from "./types";
import { clampConfidence } from "./types";
import { firstCloseBeyond, projectMeasuredMove, stateConfidence } from "./patternState";

const MAX_EXTREME_GAP_ATR = 0.5;
const MIN_BAR_SEPARATION = 6;

function scanVariant(
  input: GeometryDetectorInput,
  zigzag: readonly GeometryPivot[],
  variant: "top" | "bottom",
): PatternInstance | null {
  const { candles, atr } = input;
  const extremeKind = variant === "top" ? "high" : "low";

  // Newest quintuple first: [E, c, E, c, E].
  for (let end = zigzag.length - 1; end >= 4; end--) {
    const e3 = zigzag[end]!;
    const c2 = zigzag[end - 1]!;
    const e2 = zigzag[end - 2]!;
    const c1 = zigzag[end - 3]!;
    const e1 = zigzag[end - 4]!;
    if (
      e1.kind !== extremeKind || e2.kind !== extremeKind || e3.kind !== extremeKind ||
      c1.kind === extremeKind || c2.kind === extremeKind
    ) {
      continue;
    }
    if (e2.index - e1.index < MIN_BAR_SEPARATION) continue;
    if (e3.index - e2.index < MIN_BAR_SEPARATION) continue;

    const prices = [e1.price, e2.price, e3.price];
    const level = variant === "top" ? Math.max(...prices) : Math.min(...prices);
    const spread = Math.max(...prices) - Math.min(...prices);
    if (spread > MAX_EXTREME_GAP_ATR * atr) continue;

    // Conservative neckline: the counter-pivot FURTHER from the extremes.
    const necklinePrice =
      variant === "top" ? Math.min(c1.price, c2.price) : Math.max(c1.price, c2.price);
    const height = Math.abs(level - necklinePrice);
    if (!(height > atr * 0.6)) continue;

    const breakDirection: "up" | "down" = variant === "top" ? "down" : "up";
    const completion = firstCloseBeyond(candles, e3.index, () => necklinePrice, breakDirection, atr);
    const invalidation = firstCloseBeyond(
      candles,
      e3.index,
      () => level,
      variant === "top" ? "up" : "down",
      atr,
    );

    let status: PatternInstance["status"] = "forming";
    if (completion.status === "broken" && invalidation.status === "broken") {
      status = invalidation.breakIndex! < completion.breakIndex! ? "invalidated" : "completed";
    } else if (invalidation.status === "broken") {
      status = "invalidated";
    } else if (completion.status === "broken") {
      status = "completed";
    }

    // Three touches on one level earn a higher floor than two would: the level
    // is proven, not presumed.
    const base = 62 + Math.min(10, (height / atr) * 3) +
      Math.min(8, (1 - spread / (MAX_EXTREME_GAP_ATR * atr)) * 8);

    return {
      patternType: variant === "top" ? "triple_top" : "triple_bottom",
      status,
      anchors: [e1, c1, e2, c2, e3],
      neckline: {
        from: { time: e1.time, price: necklinePrice },
        to: { time: e3.time, price: necklinePrice },
      },
      projectedTarget: projectMeasuredMove(necklinePrice, height, breakDirection),
      breakDirection,
      confidence: clampConfidence(stateConfidence(base, status)),
      evidence: [
        `level=${level.toFixed(5)} (3 touches, spread ${(spread / atr).toFixed(2)}atr)`,
        `neckline=${necklinePrice.toFixed(5)}`,
        `height=${(height / atr).toFixed(2)}atr`,
      ],
    };
  }
  return null;
}

export function detectTripleExtremes(
  input: GeometryDetectorInput,
  zigzag: readonly GeometryPivot[],
): PatternInstance[] {
  if (input.atr <= 0 || zigzag.length < 5) return [];
  const out: PatternInstance[] = [];
  const top = scanVariant(input, zigzag, "top");
  if (top) out.push(top);
  const bottom = scanVariant(input, zigzag, "bottom");
  if (bottom) out.push(bottom);
  return out;
}
