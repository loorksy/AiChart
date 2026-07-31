/**
 * Cup and handle, and its inverse.
 *
 * A rounded base between two rim highs at one level, then a shallow pullback —
 * the handle — that holds the upper part of the cup before the rim breaks. The
 * inverse mirrors it downward.
 *
 * Two rules keep false positives down, because this is the shape people most
 * want to see where it is not:
 *
 *  1. The base must be ROUNDED, not a spike: the bottom sits in the middle
 *     third of the span, and depth is bounded both ways.
 *  2. The handle must stay in the upper half of the cup. A pullback to the cup
 *     bottom is not a handle — it is the base failing to hold.
 */
import type {
  GeometryDetectorInput,
  GeometryPivot,
  PatternInstance,
} from "./types";
import { clampConfidence } from "./types";
import { firstCloseBeyond, projectMeasuredMove, stateConfidence } from "./patternState";

/** Rim highs within this many ATR of each other. */
const RIM_TOLERANCE_ATR = 0.6;
/**
 * Cup depth bounds. Too shallow is drift; the upper bound is generous because
 * depth alone does not make a V — the roundedness and handle rules are what
 * reject spike-and-recover shapes, and a genuinely deep rounded base is a
 * stronger cup, not a disqualified one.
 */
const MIN_DEPTH_ATR = 1.5;
const MAX_DEPTH_ATR = 12;
/** Handle retracement of cup depth: beyond this the base did not hold. */
const MAX_HANDLE_RETRACE = 0.5;

function scanVariant(
  input: GeometryDetectorInput,
  zigzag: readonly GeometryPivot[],
  variant: "cup" | "inverse",
): PatternInstance | null {
  const { candles, atr } = input;
  const rimKind = variant === "cup" ? "high" : "low";

  // [rim, bottom, rim, handle-extreme] — newest first.
  for (let end = zigzag.length - 1; end >= 3; end--) {
    const handlePivot = zigzag[end]!;
    const rim2 = zigzag[end - 1]!;
    const base = zigzag[end - 2]!;
    const rim1 = zigzag[end - 3]!;
    if (
      rim1.kind !== rimKind || rim2.kind !== rimKind ||
      base.kind === rimKind || handlePivot.kind === rimKind
    ) {
      continue;
    }

    const rimLevel =
      variant === "cup" ? Math.max(rim1.price, rim2.price) : Math.min(rim1.price, rim2.price);
    if (Math.abs(rim1.price - rim2.price) > RIM_TOLERANCE_ATR * atr) continue;

    const depth = Math.abs(rimLevel - base.price);
    if (depth < MIN_DEPTH_ATR * atr || depth > MAX_DEPTH_ATR * atr) continue;

    // Roundedness: the bottom sits in the middle third of the cup's span. A
    // bottom hugging either rim is a spike-and-recover, not a rounded base.
    const span = rim2.index - rim1.index;
    if (span < 10) continue;
    const basePosition = (base.index - rim1.index) / span;
    if (basePosition < 0.3 || basePosition > 0.7) continue;

    // The handle holds the upper half of the cup.
    const handleRetrace = Math.abs(rimLevel - handlePivot.price) / depth;
    if (handleRetrace > MAX_HANDLE_RETRACE) continue;
    if (handlePivot.index - rim2.index < 3) continue;

    const breakDirection: "up" | "down" = variant === "cup" ? "up" : "down";
    const completion = firstCloseBeyond(
      candles,
      handlePivot.index,
      () => rimLevel,
      breakDirection,
      atr,
    );
    // Invalidation: the handle deepens past half the cup — the base failed.
    const invalidationLevel =
      variant === "cup" ? rimLevel - depth * MAX_HANDLE_RETRACE : rimLevel + depth * MAX_HANDLE_RETRACE;
    const invalidation = firstCloseBeyond(
      candles,
      handlePivot.index,
      () => invalidationLevel,
      variant === "cup" ? "down" : "up",
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

    const base_ = 56 + Math.min(10, (depth / atr) * 2) +
      Math.min(8, (1 - handleRetrace / MAX_HANDLE_RETRACE) * 8);

    return {
      patternType: variant === "cup" ? "cup_and_handle" : "inverse_cup_and_handle",
      status,
      anchors: [rim1, base, rim2, handlePivot],
      neckline: {
        from: { time: rim1.time, price: rimLevel },
        to: { time: handlePivot.time, price: rimLevel },
      },
      projectedTarget: projectMeasuredMove(rimLevel, depth, breakDirection),
      breakDirection,
      confidence: clampConfidence(stateConfidence(base_, status)),
      evidence: [
        `rim=${rimLevel.toFixed(5)}`,
        `depth=${(depth / atr).toFixed(2)}atr`,
        `handle_retrace=${(handleRetrace * 100).toFixed(0)}%`,
        `base_position=${(basePosition * 100).toFixed(0)}%`,
      ],
    };
  }
  return null;
}

export function detectCupHandle(
  input: GeometryDetectorInput,
  zigzag: readonly GeometryPivot[],
): PatternInstance[] {
  if (input.atr <= 0 || zigzag.length < 4) return [];
  const out: PatternInstance[] = [];
  const cup = scanVariant(input, zigzag, "cup");
  if (cup) out.push(cup);
  const inverse = scanVariant(input, zigzag, "inverse");
  if (inverse) out.push(inverse);
  return out;
}
