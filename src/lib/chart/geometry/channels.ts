/**
 * Channel detection: a parallel boundary fitted against an accepted trendline.
 *
 * For each base trendline, the opposite-side pivots inside its span vote on a
 * parallel offset. A channel is accepted when at least two opposite pivots sit
 * within 0.15×ATR of the offset line and the width is between 1 and 8 ATR —
 * wide enough to matter, narrow enough to still be one structure.
 */
import type {
  ChannelGeometry,
  GeometryDetectorInput,
  GeometryPivot,
  TrendlineGeometry,
} from "./types";
import { clampConfidence, linePriceAtIndex } from "./types";

const OPPOSITE_TOUCH_TOLERANCE_ATR = 0.15;
const MIN_WIDTH_ATR = 1;
const MAX_WIDTH_ATR = 8;
const MIN_OPPOSITE_TOUCHES = 2;
/** Slope below this (ATR per bar) reads as a horizontal channel. */
const HORIZONTAL_SLOPE_ATR_PER_BAR = 0.03;

export function detectChannels(
  input: GeometryDetectorInput,
  trendlines: readonly TrendlineGeometry[],
): ChannelGeometry[] {
  const { atr } = input;
  if (atr <= 0) return [];
  const out: ChannelGeometry[] = [];

  for (const base of trendlines) {
    const oppositeKind = base.side === "support" ? "high" : "low";
    const [a, b] = base.anchors;
    const opposite = input.pivots.filter(
      (p) =>
        p.kind === oppositeKind && p.index >= a.index && p.index <= b.index,
    );
    if (opposite.length < MIN_OPPOSITE_TOUCHES) continue;

    // Offset from the base line per opposite pivot; the extreme offset is the
    // channel boundary candidate (deterministic — ties keep the earliest).
    const offsets = opposite.map((p) => ({
      pivot: p,
      offset: p.price - linePriceAtIndex(a, b, p.index),
    }));
    const boundary = offsets.reduce((best, current) =>
      base.side === "support"
        ? current.offset > best.offset
          ? current
          : best
        : current.offset < best.offset
          ? current
          : best,
    );

    const widthAtr = Math.abs(boundary.offset) / atr;
    if (widthAtr < MIN_WIDTH_ATR || widthAtr > MAX_WIDTH_ATR) continue;

    const tol = Math.max(atr * OPPOSITE_TOUCH_TOLERANCE_ATR, Number.EPSILON);
    const touching = offsets.filter(
      (o) => Math.abs(o.offset - boundary.offset) <= tol,
    );
    if (touching.length < MIN_OPPOSITE_TOUCHES) continue;

    // Parallel boundary anchored at the base anchors' bar positions.
    const parallel: [GeometryPivot, GeometryPivot] = [
      {
        index: a.index,
        time: a.time,
        price: a.price + boundary.offset,
        kind: oppositeKind,
      },
      {
        index: b.index,
        time: b.time,
        price: b.price + boundary.offset,
        kind: oppositeKind,
      },
    ];

    const slopeAtrPerBar = base.slope / atr;
    const direction =
      Math.abs(slopeAtrPerBar) < HORIZONTAL_SLOPE_ATR_PER_BAR
        ? "horizontal"
        : base.slope > 0
          ? "rising"
          : "falling";

    out.push({
      direction,
      base,
      parallel,
      widthAtr,
      oppositeTouches: touching.length,
      confidence: clampConfidence(
        base.confidence * 0.6 + touching.length * 10 + Math.min(10, widthAtr * 2),
      ),
      evidence: [
        `base=${base.side}`,
        `width=${widthAtr.toFixed(1)}atr`,
        `${touching.length} opposite touches`,
      ],
    });
  }

  // One channel max — keep the strongest (bounded output contract).
  out.sort((x, y) => y.confidence - x.confidence);
  return out.slice(0, 1);
}
