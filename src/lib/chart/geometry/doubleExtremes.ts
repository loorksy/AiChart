/**
 * Double tops / double bottoms (M / W shapes).
 *
 * Two same-side extremes within 0.4×ATR of each other, at least 8 bars apart,
 * with one intervening counter-pivot — the neckline. Completed on a CLOSE
 * beyond the neckline; invalidated on a close beyond the extremes in the
 * opposite direction. Target = height projected from the neckline.
 */
import type {
  GeometryDetectorInput,
  GeometryPivot,
  PatternInstance,
} from "./types";
import { clampConfidence } from "./types";
import {
  firstCloseBeyond,
  projectMeasuredMove,
  stateConfidence,
} from "./patternState";

const MAX_EXTREME_GAP_ATR = 0.4;
const MIN_BAR_SEPARATION = 8;

function scanVariant(
  input: GeometryDetectorInput,
  zigzag: readonly GeometryPivot[],
  variant: "top" | "bottom",
): PatternInstance | null {
  const { candles, atr } = input;
  const extremeKind = variant === "top" ? "high" : "low";

  // Newest triple first: [extreme, counter, extreme].
  for (let end = zigzag.length - 1; end >= 2; end--) {
    const second = zigzag[end]!;
    const middle = zigzag[end - 1]!;
    const first = zigzag[end - 2]!;
    if (
      first.kind !== extremeKind ||
      second.kind !== extremeKind ||
      middle.kind === extremeKind
    ) {
      continue;
    }
    if (second.index - first.index < MIN_BAR_SEPARATION) continue;
    if (Math.abs(second.price - first.price) > MAX_EXTREME_GAP_ATR * atr) continue;

    const necklinePrice = middle.price;
    const extremePrice =
      variant === "top"
        ? Math.max(first.price, second.price)
        : Math.min(first.price, second.price);
    const height = Math.abs(extremePrice - necklinePrice);
    if (!(height > atr * 0.5)) continue; // too shallow to be a reversal shape

    const breakDirection: "up" | "down" = variant === "top" ? "down" : "up";
    const completion = firstCloseBeyond(
      candles,
      second.index,
      () => necklinePrice,
      breakDirection,
      atr,
    );
    const invalidation = firstCloseBeyond(
      candles,
      second.index,
      () => extremePrice,
      variant === "top" ? "up" : "down",
      atr,
    );

    let status: PatternInstance["status"] = "forming";
    if (completion.status === "broken" && invalidation.status === "broken") {
      status =
        invalidation.breakIndex! < completion.breakIndex!
          ? "invalidated"
          : "completed";
    } else if (invalidation.status === "broken") {
      status = "invalidated";
    } else if (completion.status === "broken") {
      status = "completed";
    }

    const base =
      58 +
      Math.min(12, (height / atr) * 4) +
      Math.min(
        10,
        (1 - Math.abs(second.price - first.price) / (MAX_EXTREME_GAP_ATR * atr)) * 10,
      );

    return {
      patternType: variant === "top" ? "double_top" : "double_bottom",
      status,
      anchors: [first, middle, second],
      neckline: {
        from: { time: first.time, price: necklinePrice },
        to: { time: second.time, price: necklinePrice },
      },
      projectedTarget: projectMeasuredMove(necklinePrice, height, breakDirection),
      breakDirection,
      confidence: clampConfidence(stateConfidence(base, status)),
      evidence: [
        `extremes ${first.price.toFixed(5)}/${second.price.toFixed(5)}`,
        `gap=${(Math.abs(second.price - first.price) / atr).toFixed(2)}atr`,
        `height=${(height / atr).toFixed(2)}atr`,
      ],
    };
  }
  return null;
}

export function detectDoubleExtremes(
  input: GeometryDetectorInput,
  zigzag: readonly GeometryPivot[],
): PatternInstance[] {
  if (input.atr <= 0 || zigzag.length < 3) return [];
  const out: PatternInstance[] = [];
  const top = scanVariant(input, zigzag, "top");
  if (top) out.push(top);
  const bottom = scanVariant(input, zigzag, "bottom");
  if (bottom) out.push(bottom);
  return out;
}
