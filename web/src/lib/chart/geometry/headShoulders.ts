/**
 * Head & shoulders (and inverse) — template match over the zigzag.
 *
 * A 5-extreme window H1-L1-H2-L2-H3 (or mirrored) where the head exceeds both
 * shoulders by ≥ 0.8×ATR and the shoulders are symmetric within 35% of the
 * head height. Neckline = line through the two inner troughs (peaks for the
 * inverse). Completed on a CLOSE beyond the extended neckline; invalidated on
 * a close beyond the head. Target = neckline break − head height (mirrored
 * for the inverse).
 */
import type {
  GeometryDetectorInput,
  GeometryPivot,
  PatternInstance,
} from "./types";
import { clampConfidence, linePriceAt } from "./types";
import {
  firstCloseBeyond,
  projectMeasuredMove,
  stateConfidence,
} from "./patternState";

const MIN_HEAD_PROMINENCE_ATR = 0.8;
const MAX_SHOULDER_ASYMMETRY = 0.35;

function scanVariant(
  input: GeometryDetectorInput,
  zigzag: readonly GeometryPivot[],
  inverse: boolean,
): PatternInstance | null {
  const { candles, atr } = input;
  const peakKind = inverse ? "low" : "high";

  // Walk 5-pivot windows newest-first so the most recent formation wins.
  for (let end = zigzag.length - 1; end >= 4; end--) {
    const window = zigzag.slice(end - 4, end + 1);
    const [p1, t1, head, t2, p2] = window as [
      GeometryPivot,
      GeometryPivot,
      GeometryPivot,
      GeometryPivot,
      GeometryPivot,
    ];
    if (
      p1.kind !== peakKind ||
      head.kind !== peakKind ||
      p2.kind !== peakKind ||
      t1.kind === peakKind ||
      t2.kind === peakKind
    ) {
      continue;
    }

    const sign = inverse ? -1 : 1;
    const headProminence = Math.min(
      sign * (head.price - p1.price),
      sign * (head.price - p2.price),
    );
    if (headProminence < MIN_HEAD_PROMINENCE_ATR * atr) continue;

    const necklineAt = (time: number) => linePriceAt(t1, t2, time);
    const headHeight = Math.abs(head.price - necklineAt(head.time));
    if (!(headHeight > 0)) continue;

    const shoulderGap = Math.abs(p1.price - p2.price);
    if (shoulderGap > headHeight * MAX_SHOULDER_ASYMMETRY) continue;

    const breakDirection: "up" | "down" = inverse ? "up" : "down";
    const necklineAtIndex = (index: number) => {
      const candle = candles[index];
      return candle ? necklineAt(candle.time) : Number.NaN;
    };

    const invalidation = firstCloseBeyond(
      candles,
      p2.index,
      () => head.price,
      inverse ? "down" : "up",
      atr,
    );
    const completion = firstCloseBeyond(
      candles,
      p2.index,
      necklineAtIndex,
      breakDirection,
      atr,
    );

    let status: PatternInstance["status"] = "forming";
    if (invalidation.status === "broken" && completion.status === "broken") {
      status =
        invalidation.breakIndex! < completion.breakIndex!
          ? "invalidated"
          : "completed";
    } else if (invalidation.status === "broken") {
      status = "invalidated";
    } else if (completion.status === "broken") {
      status = "completed";
    }

    const breakLevel =
      completion.breakIndex != null
        ? necklineAtIndex(completion.breakIndex)
        : necklineAt(candles[candles.length - 1]!.time);

    const base =
      60 +
      Math.min(10, (headProminence / atr) * 5) +
      Math.min(10, (1 - shoulderGap / (headHeight || 1)) * 10);

    return {
      patternType: inverse ? "inverse_head_and_shoulders" : "head_and_shoulders",
      status,
      anchors: [p1, t1, head, t2, p2],
      neckline: {
        from: { time: t1.time, price: t1.price },
        to: { time: t2.time, price: t2.price },
      },
      projectedTarget: projectMeasuredMove(breakLevel, headHeight, breakDirection),
      breakDirection,
      confidence: clampConfidence(stateConfidence(base, status)),
      evidence: [
        `head_prominence=${(headProminence / atr).toFixed(2)}atr`,
        `shoulder_asymmetry=${(shoulderGap / headHeight).toFixed(2)}`,
        `neckline ${t1.price.toFixed(5)}→${t2.price.toFixed(5)}`,
      ],
    };
  }
  return null;
}

export function detectHeadShoulders(
  input: GeometryDetectorInput,
  zigzag: readonly GeometryPivot[],
): PatternInstance[] {
  if (input.atr <= 0 || zigzag.length < 5) return [];
  const out: PatternInstance[] = [];
  const regular = scanVariant(input, zigzag, false);
  if (regular) out.push(regular);
  const inverse = scanVariant(input, zigzag, true);
  if (inverse) out.push(inverse);
  return out;
}
