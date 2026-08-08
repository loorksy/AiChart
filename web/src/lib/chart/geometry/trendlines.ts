/**
 * Multi-trendline detection, both sides. This is THE trendline algorithm —
 * the chat-command engine (agent/drawingCommands/trendlineEvidence.ts)
 * delegates to `evaluateTrendlineCandidates` instead of mirroring it.
 *
 * A trendline is an ENVELOPE, not merely two connectable pivots:
 *
 *  - Envelope rule (close-based, documented choice): from the FIRST anchor to
 *    the LAST candle of the window, no candle may CLOSE beyond the line by
 *    more than 0.25×ATR (support: close below; resistance: close above).
 *    Wicks may pierce — spike stop-runs do not invalidate a respected line,
 *    but a body settling through it does. One rule covers both interior
 *    containment (the old scan started after the second anchor, so a
 *    "support" could slice through a dip between its own anchors) and the
 *    classic post-anchor break.
 *  - Touch quality: touches are PIVOTS within 0.15×ATR of the line, counted
 *    from the first anchor onward (retests of the projected line count) with
 *    ≥3 bars between counted touches. At least 2 genuine touches required —
 *    no floor fakes them.
 *  - Scoring: touches dominate (candidates are ordered by touch count before
 *    confidence, so a 3-touch flat line always beats a 2-touch steep one),
 *    then span coverage and recency. Steepness earns nothing — the old
 *    ATR-distance term rewarded steep lines over better-fitting flat ones,
 *    and horizontal lines are legitimate trendlines.
 *  - Recency: the second anchor must sit within the last MAX_ANCHOR_AGE_BARS
 *    bars, so accepted lines belong to the structure currently on screen.
 */
import type {
  GeometryCandle,
  GeometryDetectorInput,
  GeometryPivot,
  TrendlineGeometry,
} from "./types";
import { clampConfidence, linePriceAtIndex } from "./types";

const MIN_CANDLE_SEPARATION = 8;
const MIN_SCORE = 60;
const MIN_TOUCHES = 2;
const TOUCH_TOLERANCE_ATR = 0.15;
/** Bars two counted touches must be apart to count as independent tests. */
const MIN_TOUCH_SPACING_BARS = 3;
/** Close-based envelope violation tolerance (wicks may pierce; closes may not). */
const ENVELOPE_TOLERANCE_ATR = 0.25;
/** The second anchor must be within this many bars of the last candle. */
export const MAX_ANCHOR_AGE_BARS = 100;
const MAX_LINES_PER_SIDE = 2;
/** A second line must sit meaningfully apart from an accepted one. */
const COLLINEAR_TOLERANCE_ATR = 0.5;

/**
 * Pivot-quality touches: side pivots within 0.15×ATR of the line, from the
 * first anchor to the end of the series (a pivot retesting the projected line
 * beyond the second anchor is a genuine touch), spaced ≥3 bars apart. The
 * anchors themselves are pivots on the line, so every pair starts at 2.
 */
function countPivotTouches(
  sidePivots: readonly GeometryPivot[],
  a: GeometryPivot,
  b: GeometryPivot,
  atr: number,
): number {
  const tol = Math.max(atr * TOUCH_TOLERANCE_ATR, Number.EPSILON);
  let touches = 0;
  let lastCounted = Number.NEGATIVE_INFINITY;
  for (const p of sidePivots) {
    if (p.index < a.index) continue;
    const expected = linePriceAtIndex(a, b, p.index);
    if (Math.abs(p.price - expected) > tol) continue;
    if (p.index - lastCounted < MIN_TOUCH_SPACING_BARS) continue;
    touches += 1;
    lastCounted = p.index;
  }
  return touches;
}

/**
 * Envelope violation: any close beyond the line by more than 0.25×ATR between
 * the FIRST anchor and the LAST candle (interior dips included).
 */
function violatesEnvelope(
  candles: readonly GeometryCandle[],
  a: GeometryPivot,
  b: GeometryPivot,
  side: "low" | "high",
  atr: number,
): boolean {
  const tol = Math.max(atr * ENVELOPE_TOLERANCE_ATR, Number.EPSILON);
  for (let i = a.index; i < candles.length; i++) {
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

/**
 * Evaluate every pivot pair on one side and return the accepted candidates,
 * best first. Ordering is touch-count first, then confidence, then recency —
 * touches are lexicographically dominant by contract.
 *
 * `sidePivots` must be same-side pivots in ascending index order.
 */
export function evaluateTrendlineCandidates(
  candles: readonly GeometryCandle[],
  sidePivots: readonly GeometryPivot[],
  side: "low" | "high",
  atr: number,
): TrendlineGeometry[] {
  if (sidePivots.length < 2 || atr <= 0 || candles.length === 0) return [];
  const lastIndex = candles.length - 1;
  const candidates: TrendlineGeometry[] = [];

  for (let i = 0; i < sidePivots.length - 1; i++) {
    for (let j = i + 1; j < sidePivots.length; j++) {
      const a = sidePivots[i]!;
      const b = sidePivots[j]!;
      const candleSeparation = b.index - a.index;
      if (candleSeparation < MIN_CANDLE_SEPARATION) continue;

      const anchorAge = lastIndex - b.index;
      if (anchorAge > MAX_ANCHOR_AGE_BARS) continue;

      if (violatesEnvelope(candles, a, b, side, atr)) continue;

      const touches = countPivotTouches(sidePivots, a, b, atr);
      if (touches < MIN_TOUCHES) continue;

      // Touches dominant, then span coverage, then recency. No steepness term.
      let score = 40;
      score += Math.min(30, touches * 10);
      score += Math.min(
        15,
        Math.round((15 * candleSeparation) / Math.max(1, lastIndex)),
      );
      score += Math.max(
        0,
        15 - Math.round((15 * anchorAge) / MAX_ANCHOR_AGE_BARS),
      );
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
          `${touches} pivot touches`,
          `second anchor ${anchorAge} bars ago`,
        ],
      });
    }
  }

  candidates.sort(
    (x, y) =>
      y.touches - x.touches ||
      y.confidence - x.confidence ||
      y.anchors[1].index - x.anchors[1].index ||
      x.anchors[0].index - y.anchors[0].index,
  );
  return candidates;
}

function detectSide(
  input: GeometryDetectorInput,
  side: "low" | "high",
): TrendlineGeometry[] {
  const pivots = input.pivots.filter((p) =>
    side === "low" ? p.kind === "low" : p.kind === "high",
  );
  const candidates = evaluateTrendlineCandidates(
    input.candles,
    pivots,
    side,
    input.atr,
  );

  const accepted: TrendlineGeometry[] = [];
  for (const candidate of candidates) {
    if (accepted.length >= MAX_LINES_PER_SIDE) break;
    if (accepted.every((line) => isDistinctLine(candidate, line, input.atr))) {
      accepted.push(candidate);
    }
  }
  return accepted;
}

/** Top non-collinear envelope trendlines, both sides. Deterministic. */
export function detectTrendlines(
  input: GeometryDetectorInput,
): TrendlineGeometry[] {
  return [...detectSide(input, "low"), ...detectSide(input, "high")];
}
