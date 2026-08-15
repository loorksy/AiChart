/**
 * G5 — strategy match and backtest evidence.
 *
 * The rule this enforces is the difference between a number and a claim. A
 * win rate computed over 12 trades is not a 61% edge; it is noise with a
 * decimal point. The platform may still issue a recommendation without a
 * calibrated strategy behind it — but then it must not quote statistics, and
 * it must say so in the plan rather than let the operator infer backing that
 * does not exist.
 *
 * So this gate has three outcomes, not two:
 *   - a calibrated match  → pass, cite the stats, confidence comes FROM them
 *   - an uncalibrated match → pass, labelled "غير مُعاير", no stats quoted
 *   - no match at all      → veto, WAIT
 */

/** Below this, a strategy's live/backtest record may not be cited as evidence. */
export const MIN_SAMPLE_SIZE = 100;

export interface StrategyMatch {
  strategyId: string;
  /** Completed backtested trades behind the stats. */
  sampleSize: number;
  /** 0..1 */
  winRate?: number;
  /** In R. */
  expectancy?: number;
  /** 0..100 — the calibrated figure, never the model's intuition. */
  calibratedConfidence?: number;
  session?: string;
}

export type EvidenceGrade = "calibrated" | "uncalibrated" | "none";

export interface StrategyEvidenceVerdict {
  grade: EvidenceGrade;
  match?: StrategyMatch;
  /** Only populated when grade === "calibrated". */
  citableStats?: {
    sampleSize: number;
    winRate: number;
    expectancy?: number;
    calibratedConfidence: number;
  };
  reasonAr: string;
}

/**
 * Grade the best available match.
 *
 * `calibratedConfidence` is required for a calibrated grade, not derived here:
 * a win rate alone is not calibration, and computing one on the fly would
 * reintroduce exactly the unvalidated number this gate exists to refuse.
 */
export function gradeStrategyEvidence(
  matches: StrategyMatch[],
  minSample: number = MIN_SAMPLE_SIZE,
): StrategyEvidenceVerdict {
  if (matches.length === 0) {
    return {
      grade: "none",
      reasonAr: "لا توجد استراتيجية مطابقة لظروف السوق الحالية — لا توصية.",
    };
  }

  // Prefer the best-evidenced match, not the most flattering one: sample size
  // first, then calibrated confidence. Sorting by win rate would systematically
  // surface small, lucky samples.
  const ranked = [...matches].sort((a, b) => {
    if (b.sampleSize !== a.sampleSize) return b.sampleSize - a.sampleSize;
    return (b.calibratedConfidence ?? 0) - (a.calibratedConfidence ?? 0);
  });
  const best = ranked[0]!;

  if (
    best.sampleSize >= minSample &&
    best.calibratedConfidence != null &&
    best.winRate != null
  ) {
    return {
      grade: "calibrated",
      match: best,
      citableStats: {
        sampleSize: best.sampleSize,
        winRate: best.winRate,
        expectancy: best.expectancy,
        calibratedConfidence: best.calibratedConfidence,
      },
      reasonAr: `استراتيجية ${best.strategyId} — معدل نجاح مُعاير ${Math.round(
        best.winRate * 100,
      )}% على ${best.sampleSize} صفقة.`,
    };
  }

  return {
    grade: "uncalibrated",
    match: best,
    reasonAr: `استراتيجية ${best.strategyId} مطابقة لكنها غير مُعايرة (${best.sampleSize} صفقة فقط، الحد ${minSample}) — لن تُذكر أي نسب.`,
  };
}

/**
 * The confidence a plan may claim.
 *
 * Calibrated evidence sets it. Without calibration there is no honest number
 * to state, so the caller must present the plan without a percentage rather
 * than substitute the model's own certainty — which is what "calibrated
 * confidence, never LLM intuition" means in practice.
 */
export function confidenceFromEvidence(
  verdict: StrategyEvidenceVerdict,
): number | null {
  return verdict.grade === "calibrated"
    ? (verdict.citableStats?.calibratedConfidence ?? null)
    : null;
}
