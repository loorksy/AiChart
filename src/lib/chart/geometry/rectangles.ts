/**
 * Rectangles — horizontal consolidation between two flat boundaries.
 *
 * The shape most detectors quietly misfile: a triangle detector sees converging
 * lines where there are none, a channel detector wants a slope. A rectangle is
 * defined by what it LACKS — slope and convergence — so the test here is that at
 * least two highs sit on one flat line, at least two lows on another, and the
 * band between them holds.
 *
 * Completed on a close beyond either boundary (the break side, not a presumed
 * one — rectangles break both ways). Invalidated only by the opposite break
 * after a first break, which is a failed breakout, itself worth knowing.
 */
import type {
  GeometryDetectorInput,
  GeometryPivot,
  PatternInstance,
} from "./types";
import { clampConfidence } from "./types";
import { firstCloseBeyond, projectMeasuredMove, stateConfidence } from "./patternState";

/** Boundary flatness: pivots within this many ATR of their shared line. */
const BOUNDARY_TOLERANCE_ATR = 0.35;
/** Minimum band height — flatter than this is noise, not consolidation. */
const MIN_HEIGHT_ATR = 1.2;
/** Maximum band height relative to its length — taller than wide is a range, not a rectangle. */
const MIN_SPAN_BARS = 12;

export function detectRectangles(
  input: GeometryDetectorInput,
  zigzag: readonly GeometryPivot[],
): PatternInstance[] {
  const { candles, atr } = input;
  if (atr <= 0 || zigzag.length < 4) return [];

  // Work on the most recent window of pivots: a rectangle is a live structure,
  // and one that ended fifty bars ago is history the trendline pass already has.
  const recent = zigzag.slice(-8);
  const highs = recent.filter((p) => p.kind === "high");
  const lows = recent.filter((p) => p.kind === "low");
  if (highs.length < 2 || lows.length < 2) return [];

  const top = median(highs.map((p) => p.price));
  const bottom = median(lows.map((p) => p.price));
  const height = top - bottom;
  if (!(height >= MIN_HEIGHT_ATR * atr)) return [];

  // Every boundary pivot must sit on its line. One stray pivot means the
  // structure is something else — describing it as a rectangle would be the
  // invented-name failure the doctrine forbids.
  const tolerance = BOUNDARY_TOLERANCE_ATR * atr;
  if (highs.some((p) => Math.abs(p.price - top) > tolerance)) return [];
  if (lows.some((p) => Math.abs(p.price - bottom) > tolerance)) return [];

  const anchors = [...recent].sort((a, b) => a.index - b.index);
  const first = anchors[0]!;
  const last = anchors[anchors.length - 1]!;
  if (last.index - first.index < MIN_SPAN_BARS) return [];

  // Break state: whichever boundary closed beyond first wins the direction.
  const upBreak = firstCloseBeyond(candles, last.index, () => top, "up", atr);
  const downBreak = firstCloseBeyond(candles, last.index, () => bottom, "down", atr);

  let status: PatternInstance["status"] = "forming";
  let breakDirection: "up" | "down" | undefined;
  if (upBreak.status === "broken" && downBreak.status === "broken") {
    // Broke one way then the other: the first break failed. That is an
    // invalidated breakout, and saying so beats pretending the second break is
    // a fresh completion.
    status = "invalidated";
    breakDirection = upBreak.breakIndex! < downBreak.breakIndex! ? "up" : "down";
  } else if (upBreak.status === "broken") {
    status = "completed";
    breakDirection = "up";
  } else if (downBreak.status === "broken") {
    status = "completed";
    breakDirection = "down";
  }

  const touches = highs.length + lows.length;
  const base = 55 + Math.min(12, (touches - 4) * 3) + Math.min(8, (height / atr - MIN_HEIGHT_ATR) * 3);

  return [
    {
      patternType: "rectangle",
      status,
      anchors,
      neckline: {
        from: { time: first.time, price: breakDirection === "down" ? bottom : top },
        to: { time: last.time, price: breakDirection === "down" ? bottom : top },
      },
      projectedTarget: breakDirection
        ? projectMeasuredMove(breakDirection === "up" ? top : bottom, height, breakDirection)
        : undefined,
      breakDirection,
      confidence: clampConfidence(stateConfidence(base, status)),
      evidence: [
        `band ${bottom.toFixed(5)}–${top.toFixed(5)}`,
        `height=${(height / atr).toFixed(2)}atr`,
        `touches=${touches}`,
        `span=${last.index - first.index}bars`,
      ],
    },
  ];
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}
