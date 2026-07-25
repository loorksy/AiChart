/**
 * Multi-trendline detection, both sides.
 *
 * Generalises the single-line `proposeStructuralTrendline` recipe: the same
 * pivot-pair scan and the same evidence scoring (base 40 + separation ≤ 25 +
 * ATR-normalised distance ≤ 20 + touches ≤ 15, accept ≥ 60), but it returns
 * the top K non-collinear lines PER SIDE instead of one line for one side —
 * and the `Math.max(touches, 2)` floor is gone, so the touch component
 * actually differentiates weak lines from respected ones.
 */
import type {
  GeometryCandle,
  GeometryDetectorInput,
  GeometryPivot,
  TrendlineGeometry,
} from "./types";
import { clampConfidence, linePriceAtIndex } from "./types";

const MIN_CANDLE_SEPARATION = 8;
const MIN_ATR_DISTANCE = 0.0; // horizontal lines are legitimate trendlines
const MIN_SCORE = 60;
const TOUCH_TOLERANCE_ATR = 0.15;
const BREAK_TOLERANCE_ATR = 0.25;
const MAX_LINES_PER_SIDE = 2;
/** A second line must sit meaningfully apart from an accepted one. */
const COLLINEAR_TOLERANCE_ATR = 0.5;

function countLineTouches(
  candles: readonly GeometryCandle[],
  a: GeometryPivot,
  b: GeometryPivot,
  side: "low" | "high",
  atr: number,
): number {
  const tol = Math.max(atr * TOUCH_TOLERANCE_ATR, Number.EPSILON);
  let touches = 0;
  for (let i = a.index; i <= Math.min(b.index, candles.length - 1); i++) {
    const candle = candles[i]!;
    const expected = linePriceAtIndex(a, b, i);
    const price = side === "low" ? candle.low : candle.high;
    if (Math.abs(price - expected) <= tol) touches += 1;
  }
  return touches;
}

function isLineBroken(
  candles: readonly GeometryCandle[],
  a: GeometryPivot,
  b: GeometryPivot,
  side: "low" | "high",
  atr: number,
): boolean {
  const tol = Math.max(atr * BREAK_TOLERANCE_ATR, Number.EPSILON);
  for (let i = b.index + 1; i < candles.length; i++) {
    const expected = linePriceAtIndex(a, b, i);
    const close = candles[i]!.close;
    if (side === "low" && close < expected - tol) return true;
    if (side === "high" && close > expected + tol) return true;
  }
  return false;
}

/** Non-collinearity: the candidate's anchors must not both lie on `accepted`. */
function isDistinctLine(
  candidate: { anchors: [GeometryPivot, GeometryPivot] },
  accepted: TrendlineGeometry,
  atr: number,
): boolean {
  const tol = Math.max(atr * COLLINEAR_TOLERANCE_ATR, Number.EPSILON);
  const [a, b] = accepted.anchors;
  const deviations = candidate.anchors.map((p) =>
    Math.abs(p.price - linePriceAtIndex(a, b, p.index)),
  );
  return Math.max(...deviations) > tol;
}

function detectSide(
  input: GeometryDetectorInput,
  side: "low" | "high",
): TrendlineGeometry[] {
  const { candles, atr } = input;
  const pivots = input.pivots.filter((p) =>
    side === "low" ? p.kind === "low" : p.kind === "high",
  );
  if (pivots.length < 2 || atr <= 0) return [];

  const lastIndex = candles.length - 1;
  const candidates: TrendlineGeometry[] = [];

  for (let i = 0; i < pivots.length - 1; i++) {
    for (let j = i + 1; j < pivots.length; j++) {
      const a = pivots[i]!;
      const b = pivots[j]!;
      const candleSeparation = b.index - a.index;
      if (candleSeparation < MIN_CANDLE_SEPARATION) continue;

      const atrNorm = Math.abs(b.price - a.price) / atr;
      if (atrNorm < MIN_ATR_DISTANCE) continue;

      const touches = countLineTouches(candles, a, b, side, atr);
      const broken = isLineBroken(candles, a, b, side, atr);
      if (broken) continue;

      let score = 40;
      score += Math.min(25, candleSeparation);
      score += Math.min(20, atrNorm * 20);
      score += Math.min(15, Math.max(0, touches - 2) * 5);
      if (score < MIN_SCORE) continue;

      candidates.push({
        side: side === "low" ? "support" : "resistance",
        anchors: [a, b],
        slope: (b.price - a.price) / Math.max(1, candleSeparation),
        touches,
        candleSeparation,
        priceAtLastBar: linePriceAtIndex(a, b, lastIndex),
        broken: false,
        confidence: clampConfidence(score),
        evidence: [
          `${candleSeparation} bars separation`,
          `${touches} touches`,
          `atr_distance=${atrNorm.toFixed(2)}`,
        ],
      });
    }
  }

  candidates.sort(
    (x, y) =>
      y.confidence - x.confidence ||
      y.anchors[1].index - x.anchors[1].index ||
      x.anchors[0].index - y.anchors[0].index,
  );

  const accepted: TrendlineGeometry[] = [];
  for (const candidate of candidates) {
    if (accepted.length >= MAX_LINES_PER_SIDE) break;
    if (accepted.every((line) => isDistinctLine(candidate, line, atr))) {
      accepted.push(candidate);
    }
  }
  return accepted;
}

/** Top non-collinear unbroken trendlines, both sides. Deterministic. */
export function detectTrendlines(
  input: GeometryDetectorInput,
): TrendlineGeometry[] {
  return [...detectSide(input, "low"), ...detectSide(input, "high")];
}
