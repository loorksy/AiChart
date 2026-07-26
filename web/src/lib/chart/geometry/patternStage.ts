/**
 * Where a pattern is in its own life (docs/UNIFIED_AGENT_PLAN.md §7).
 *
 * The break machine answers one question — has price closed beyond a boundary —
 * and that is all "forming vs completed" ever meant. But a triangle two bars old
 * and one pressing its apex are both "forming", and they are not remotely the
 * same trade. Collapsing them is what made "the pattern is not complete" sound
 * like "there is nothing here", when the boundary of a nearly-finished structure
 * is often the best entry available.
 *
 * So the break state stays exactly as it was, and this adds the stage and how
 * far along the structure is. Neither judges the trade: they describe the
 * structure so the decision engine can weigh an early entry against waiting.
 */
import type { GeometryCandle, PatternInstance, PatternStatus } from "./types";

export type PatternStage =
  | "starting"
  | "forming"
  | "near_completion"
  | "completed_unconfirmed"
  | "confirmed"
  | "failed"
  | "hybrid"
  | "unclassified";

/** Follow-through beyond the break needed before a completion is "confirmed". */
const CONFIRMATION_ATR = 0.5;

export interface StageAssessment {
  stage: PatternStage;
  /** 0–1: how much of the structure's expected shape has actually formed. */
  completionRatio: number;
}

/**
 * How close price sits to the boundary that would complete the pattern,
 * expressed as progress toward it.
 *
 * A structure whose price is pressing its neckline is nearly done regardless of
 * how many bars it took; one drifting in the middle of its range is not.
 */
function proximityProgress(input: {
  lastClose: number;
  breakLevel: number | null;
  atr: number;
}): number | null {
  if (input.breakLevel == null || !Number.isFinite(input.breakLevel)) return null;
  if (!(input.atr > 0)) return null;
  const distanceAtr = Math.abs(input.lastClose - input.breakLevel) / input.atr;
  // At the level → 1; two ATR away → 0. Linear between, clamped.
  return Math.max(0, Math.min(1, 1 - distanceAtr / 2));
}

/**
 * Assess one detected pattern.
 *
 * `breakLevel` is the price that would complete it (a neckline, a trendline at
 * the current bar, a range edge); pass null when the detector has no single
 * such level and the assessment falls back to shape progress alone.
 */
export function assessPatternStage(input: {
  status: PatternStatus;
  anchorCount: number;
  expectedAnchors: number;
  candles: readonly GeometryCandle[];
  breakIndex?: number;
  breakLevel?: number | null;
  atr: number;
}): StageAssessment {
  const shapeProgress =
    input.expectedAnchors > 0
      ? Math.max(0, Math.min(1, input.anchorCount / input.expectedAnchors))
      : 0;

  if (input.status === "invalidated") {
    return { stage: "failed", completionRatio: shapeProgress };
  }

  if (input.status === "completed") {
    const breakIndex = input.breakIndex;
    const confirmed =
      breakIndex != null &&
      input.breakLevel != null &&
      input.atr > 0 &&
      input.candles
        .slice(breakIndex + 1)
        .some(
          (candle) =>
            Math.abs(candle.close - input.breakLevel!) > input.atr * CONFIRMATION_ATR,
        );
    return {
      stage: confirmed ? "confirmed" : "completed_unconfirmed",
      completionRatio: 1,
    };
  }

  const lastClose = input.candles.at(-1)?.close;
  const proximity =
    lastClose == null
      ? null
      : proximityProgress({
          lastClose,
          breakLevel: input.breakLevel ?? null,
          atr: input.atr,
        });

  // Shape and proximity together: a complete template still far from its break
  // is mid-formation, and a partial one pressing the level is nearly there.
  const ratio =
    proximity == null ? shapeProgress : Math.max(shapeProgress * 0.6, proximity * 0.9);

  if (ratio < 0.35) return { stage: "starting", completionRatio: ratio };
  if (ratio < 0.75) return { stage: "forming", completionRatio: ratio };
  return { stage: "near_completion", completionRatio: ratio };
}

/** Anchors a complete template of each pattern family has. */
export function expectedAnchorsFor(patternType: string): number {
  if (patternType.includes("head_shoulders")) return 5;
  if (patternType.includes("triple")) return 6;
  if (patternType.includes("double")) return 4;
  if (patternType.includes("triangle") || patternType.includes("wedge")) return 4;
  if (patternType.includes("flag") || patternType.includes("pennant")) return 3;
  return 3;
}

/**
 * The level whose breach would complete a pattern, when the detector reports
 * one. Necklines are explicit; everything else is left to shape progress.
 */
export function breakLevelOf(pattern: PatternInstance): number | null {
  if (pattern.neckline) return pattern.neckline.to.price;
  return null;
}

/** Is this stage an opportunity to enter BEFORE confirmation? */
export function offersAnticipatoryEntry(stage: PatternStage): boolean {
  return stage === "forming" || stage === "near_completion";
}
