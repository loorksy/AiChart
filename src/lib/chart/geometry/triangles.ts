/**
 * Converging-boundary patterns: triangles AND wedges.
 *
 * One machinery, one classification table — a wedge is the same construction
 * as a triangle with both boundary slopes sharing a sign, so a separate
 * detector would duplicate every line-fit and state rule:
 *
 *   upper flat    + lower rising  → ascending_triangle   (breaks up)
 *   upper falling + lower flat    → descending_triangle  (breaks down)
 *   upper falling + lower rising  → symmetrical_triangle (either way)
 *   both rising,  converging      → wedge (rising — breaks down)
 *   both falling, converging      → wedge (falling — breaks up)
 *
 * Boundaries are lines through the first/last recent pivot per side, accepted
 * only when the intermediate pivots conform (≤0.35×ATR off the line). Status
 * comes from the shared state machine: close beyond a boundary ±0.25×ATR.
 */
import type {
  GeometryDetectorInput,
  GeometryPivot,
  PatternInstance,
} from "./types";
import { clampConfidence, linePriceAtIndex } from "./types";
import {
  projectMeasuredMove,
  resolveBoundedPattern,
  stateConfidence,
} from "./patternState";

const PATTERN_WINDOW_BARS = 150;
const MIN_PIVOTS_PER_SIDE = 2;
const BOUNDARY_CONFORM_ATR = 0.35;
const FLAT_SLOPE_ATR_PER_BAR = 0.05;
/** Boundaries must have narrowed to at most this share of the start width. */
const MAX_END_WIDTH_RATIO = 0.8;
/** Forming dies when price has consumed this share of the way to the apex. */
const APEX_CONSUMED_LIMIT = 0.8;

interface BoundaryFit {
  anchors: [GeometryPivot, GeometryPivot];
  slope: number;
  conforming: number;
  pivotCount: number;
}

/**
 * Fit a boundary through the LARGEST recent pivot suffix that conforms.
 * Trying suffixes (newest pivots first, longest suffix wins) makes the fit
 * robust to older pre-pattern structure without losing determinism: a stale
 * base-noise pivot simply falls out of the suffix instead of vetoing the
 * whole boundary.
 */
function fitBoundary(pivots: GeometryPivot[], atr: number): BoundaryFit | null {
  const tol = Math.max(atr * BOUNDARY_CONFORM_ATR, Number.EPSILON);
  const maxSuffix = Math.min(pivots.length, 6);

  for (let size = maxSuffix; size >= MIN_PIVOTS_PER_SIDE; size--) {
    const subset = pivots.slice(-size);
    const first = subset[0]!;
    const last = subset[subset.length - 1]!;
    if (last.index - first.index < 8) continue;

    let conforming = 0;
    for (const pivot of subset) {
      const expected = linePriceAtIndex(first, last, pivot.index);
      if (Math.abs(pivot.price - expected) <= tol) conforming += 1;
    }
    // Every pivot in the suffix must respect the boundary — one rogue middle
    // pivot breaks the shape (so we retry with a shorter suffix).
    if (conforming < subset.length) continue;

    return {
      anchors: [first, last],
      slope: (last.price - first.price) / Math.max(1, last.index - first.index),
      conforming,
      pivotCount: subset.length,
    };
  }
  return null;
}

type SlopeClass = "flat" | "rising" | "falling";

function classifySlope(slope: number, atr: number): SlopeClass {
  const perBar = slope / Math.max(atr, Number.EPSILON);
  if (Math.abs(perBar) < FLAT_SLOPE_ATR_PER_BAR) return "flat";
  return perBar > 0 ? "rising" : "falling";
}

export function detectConvergingPatterns(
  input: GeometryDetectorInput,
): PatternInstance[] {
  const { candles, atr } = input;
  if (atr <= 0 || candles.length < 40) return [];
  const windowStart = Math.max(0, candles.length - PATTERN_WINDOW_BARS);

  const highs = input.pivots.filter(
    (p) => p.kind === "high" && p.index >= windowStart,
  );
  const lows = input.pivots.filter(
    (p) => p.kind === "low" && p.index >= windowStart,
  );

  const upper = fitBoundary(highs, atr);
  const lower = fitBoundary(lows, atr);
  if (!upper || !lower) return [];

  const startIndex = Math.max(upper.anchors[0].index, lower.anchors[0].index);
  const endIndex = Math.max(upper.anchors[1].index, lower.anchors[1].index);
  const upperAt = (i: number) => linePriceAtIndex(upper.anchors[0], upper.anchors[1], i);
  const lowerAt = (i: number) => linePriceAtIndex(lower.anchors[0], lower.anchors[1], i);

  const startWidth = upperAt(startIndex) - lowerAt(startIndex);
  const endWidth = upperAt(endIndex) - lowerAt(endIndex);
  if (!(startWidth > 0) || !(endWidth > 0)) return [];
  const converging = endWidth <= startWidth * MAX_END_WIDTH_RATIO;

  const upperClass = classifySlope(upper.slope, atr);
  const lowerClass = classifySlope(lower.slope, atr);

  let patternType: PatternInstance["patternType"] | null = null;
  let expected: "up" | "down" | "either" = "either";
  if (upperClass === "flat" && lowerClass === "rising") {
    patternType = "ascending_triangle";
    expected = "up";
  } else if (upperClass === "falling" && lowerClass === "flat") {
    patternType = "descending_triangle";
    expected = "down";
  } else if (upperClass === "falling" && lowerClass === "rising") {
    patternType = "symmetrical_triangle";
    expected = "either";
  } else if (upperClass === "rising" && lowerClass === "rising" && converging) {
    patternType = "wedge"; // rising wedge — bearish resolution expected
    expected = "down";
  } else if (upperClass === "falling" && lowerClass === "falling" && converging) {
    patternType = "wedge"; // falling wedge — bullish resolution expected
    expected = "up";
  }
  if (!patternType) return [];
  // Triangles must converge too (an expanding megaphone is not a triangle).
  if (!converging && patternType !== "ascending_triangle" && patternType !== "descending_triangle") {
    return [];
  }

  // Apex distance in bars from the pattern start (where the width closes).
  const widthShrinkPerBar = (startWidth - endWidth) / Math.max(1, endIndex - startIndex);
  const barsToApex =
    widthShrinkPerBar > 0 ? startWidth / widthShrinkPerBar : Number.POSITIVE_INFINITY;
  const consumed = (candles.length - 1 - startIndex) / barsToApex;
  const formingValid = consumed <= APEX_CONSUMED_LIMIT;

  const resolved = resolveBoundedPattern({
    candles,
    fromIndex: endIndex,
    upperAt,
    lowerAt,
    atr,
    completeDirection: expected,
    formingValid,
  });

  const breakDirection =
    resolved.breakDirection ?? (expected === "either" ? undefined : expected);
  const breakLevel =
    resolved.breakIndex != null
      ? breakDirection === "down"
        ? lowerAt(resolved.breakIndex)
        : upperAt(resolved.breakIndex)
      : breakDirection === "down"
        ? lowerAt(candles.length - 1)
        : upperAt(candles.length - 1);

  const base =
    55 +
    Math.min(10, (upper.pivotCount + lower.pivotCount - 4) * 2.5) +
    Math.min(10, (endIndex - startIndex) / 6) +
    (converging ? 5 : 0);

  return [
    {
      patternType,
      status: resolved.status,
      anchors: [
        upper.anchors[0],
        upper.anchors[1],
        lower.anchors[0],
        lower.anchors[1],
      ],
      projectedTarget:
        breakDirection != null
          ? projectMeasuredMove(breakLevel, startWidth, breakDirection)
          : undefined,
      breakDirection,
      confidence: clampConfidence(stateConfidence(base, resolved.status)),
      evidence: [
        `upper=${upperClass}`,
        `lower=${lowerClass}`,
        `width ${startWidth.toFixed(5)}→${endWidth.toFixed(5)}`,
        `pivots=${upper.pivotCount}+${lower.pivotCount}`,
      ],
    },
  ];
}
