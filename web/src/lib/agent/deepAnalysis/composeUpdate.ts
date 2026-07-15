/**
 * Compose natural operator-facing Deep Analysis updates from internal progress facts.
 * Never expose raw progress codes. Cap UX updates: start / one mid / completion.
 */
import {
  compositionFallback,
  scanForInternalLeakage,
  type UserSafeResearchProjection,
} from "../userSafeOutbound";
import type { DeepAnalysisInternalProgress } from "./store";

export type DeepAnalysisUxPhase = "start" | "intermediate" | "completion" | "failure";

export function mapProgressToUxPhase(
  progress: DeepAnalysisInternalProgress,
  priorUxCount: number,
): DeepAnalysisUxPhase | null {
  if (progress === "failed") return "failure";
  if (progress === "ready") return "completion";
  if (priorUxCount === 0 && (progress === "job_created" || progress === "polling")) {
    return "start";
  }
  if (
    priorUxCount === 1 &&
    (progress === "verifying_history" ||
      progress === "validation_running" ||
      progress === "almost_ready")
  ) {
    return "intermediate";
  }
  // Already emitted enough — suppress spam.
  return null;
}

/**
 * Deterministic natural wording from internal facts (model composition preferred
 * when an LLM call is available; this is the safe composer used by BFF/worker).
 */
export function composeDeepAnalysisUpdate(input: {
  locale: "ar" | "en";
  phase: DeepAnalysisUxPhase;
  projection?: UserSafeResearchProjection | null;
  decisionHint?: string;
}): { text: string; usedFallback: boolean; leakageHits: string[] } {
  let text: string;
  if (input.locale === "ar") {
    switch (input.phase) {
      case "start":
        text =
          "أراجع الآن كيف تصرف هذا النوع من الإعدادات في ظروف مشابهة.";
        break;
      case "intermediate":
        text =
          "ما زلت أتحقق من استقرار الإعداد عبر فترات مختلفة — سأشارك الخلاصة عند اكتمال المراجعة.";
        break;
      case "failure":
        text =
          "لم أستطع إكمال التحقق التاريخي الآن. نُبقي القرار السابق كما هو حتى تتضح أدلة أقوى.";
        break;
      case "completion":
        text = composeCompletionAr(input.projection);
        break;
    }
  } else {
    switch (input.phase) {
      case "start":
        text =
          "I am reviewing how this kind of setup behaved in similar conditions.";
        break;
      case "intermediate":
        text =
          "Still checking how stable this setup has been across different periods — I will share the conclusion when the review finishes.";
        break;
      case "failure":
        text =
          "Historical verification could not finish right now. We keep the earlier decision until stronger evidence appears.";
        break;
      case "completion":
        text = composeCompletionEn(input.projection);
        break;
    }
  }

  const leakageHits = scanForInternalLeakage(text);
  if (leakageHits.length) {
    const fb = compositionFallback({
      locale: input.locale,
      decision: input.decisionHint ?? "wait",
      projection: input.projection,
    });
    return { text: fb.text, usedFallback: true, leakageHits };
  }
  return { text, usedFallback: false, leakageHits: [] };
}

function composeCompletionAr(
  projection?: UserSafeResearchProjection | null,
): string {
  if (!projection) {
    return "انتهت المراجعة التاريخية. لم تُغيّر الخلاصة القرار السابق بشكل جوهري.";
  }
  if (projection.historicalAgreement === "supports") {
    return "انتهت المراجعة التاريخية: الأدلة تدعم الأطروحة الحالية مع حذر مناسب في التنفيذ.";
  }
  if (projection.historicalAgreement === "conflicts") {
    return "انتهت المراجعة التاريخية: الأدلة تتعارض مع الأطروحة — نُعلّق التوصية حتى يتضح إعداد أوضح.";
  }
  if (projection.historicalAgreement === "insufficient") {
    return "انتهت المراجعة التاريخية دون عينة كافية — نبقي القرار السابق بحذر.";
  }
  return "انتهت المراجعة التاريخية. نشارك التحديث ضمن نفس المحادثة دون تغيير صامت للقرار السابق.";
}

function composeCompletionEn(
  projection?: UserSafeResearchProjection | null,
): string {
  if (!projection) {
    return "Historical review finished. The conclusion did not materially change the earlier decision.";
  }
  if (projection.historicalAgreement === "supports") {
    return "Historical review finished: evidence supports the current thesis, with appropriate execution caution.";
  }
  if (projection.historicalAgreement === "conflicts") {
    return "Historical review finished: evidence conflicts with the thesis — we suspend the recommendation until a clearer setup appears.";
  }
  if (projection.historicalAgreement === "insufficient") {
    return "Historical review finished without a sufficient sample — we keep the earlier decision with caution.";
  }
  return "Historical review finished. We share the update in the same conversation without silently rewriting the earlier decision.";
}
