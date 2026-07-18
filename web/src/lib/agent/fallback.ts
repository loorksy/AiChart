/**
 * Fallback results. When the agent can't complete safely, the UI must still get
 * a well-formed result with NO market WAIT masquerading as analysis — never a
 * crash, never an invented BUY/SELL/WAIT. These are technical outcomes.
 */
import type { AppLocale } from "@/lib/i18n";
import {
  buildInformationalConfidence,
} from "./confidenceSemantics";
import type { AgentActivityEvent, AgentDecision, AgentFinalResult } from "./types";
import type { TechnicalAnalysisOutcome } from "./modelFirst/technicalOutcome";

const TECHNICAL_COPY: Record<
  TechnicalAnalysisOutcome,
  { ar: string; en: string; reasonAr: string; reasonEn: string }
> = {
  data_unavailable: {
    ar: "بيانات السوق الحية غير كافية لإصدار توصية.",
    en: "Live market data is insufficient to issue a recommendation.",
    reasonAr: "تعذّر توفير أدلة سوق كافية.",
    reasonEn: "Sufficient market evidence was unavailable.",
  },
  model_unavailable: {
    ar: "نموذج التحليل غير متاح حالياً — لم تُصدر توصية سوق.",
    en: "The analysis model is temporarily unavailable — no market recommendation was issued.",
    reasonAr: "النموذج غير متاح.",
    reasonEn: "Model unavailable.",
  },
  model_timeout: {
    ar: "انتهت مهلة نموذج التحليل قبل اكتمال القرار — لم تُصدر توصية سوق.",
    en: "The analysis model timed out before completing a decision — no market recommendation was issued.",
    reasonAr: "انتهت مهلة النموذج.",
    reasonEn: "Model timeout.",
  },
  invalid_model_output: {
    ar: "لم تُصدر توصية لأن استجابة النموذج كانت غير صالحة.",
    en: "No market recommendation was issued because the model response was invalid.",
    reasonAr: "مخرجات النموذج غير صالحة.",
    reasonEn: "Invalid model output.",
  },
  analysis_failed: {
    ar: "تعذّر إكمال التحليل — لم تُصدر توصية سوق.",
    en: "Analysis could not be completed — no market recommendation was issued.",
    reasonAr: "فشل التحليل.",
    reasonEn: "Analysis failed.",
  },
  execution_unavailable: {
    ar: "الرأي السوقي قد يكون محفوظاً، لكن التنفيذ غير متاح تقنياً الآن.",
    en: "The market opinion may remain, but execution is technically unavailable now.",
    reasonAr: "التنفيذ غير متاح.",
    reasonEn: "Execution unavailable.",
  },
  reanalysis_required: {
    ar: "يلزم إعادة تحليل بمستويات محدّثة — لم تُعتمد خطة تنفيذ.",
    en: "Reanalysis with refreshed levels is required — no executable plan was accepted.",
    reasonAr: "يلزم إعادة التحليل.",
    reasonEn: "Reanalysis required.",
  },
};

/** Technical failure fallback — never maps to analytical WAIT. */
export function buildAgentFallbackResult(
  reason: string,
  activityEvents: AgentActivityEvent[] = [],
  locale: AppLocale = "ar",
  decision: AgentDecision = "analysis_failed",
): AgentFinalResult {
  const confidenceSemantics = buildInformationalConfidence({ analysisConfidence: 0 });
  const technical = TECHNICAL_COPY[decision as TechnicalAnalysisOutcome];
  const summary = technical
    ? locale === "en"
      ? technical.en
      : technical.ar
    : locale === "en"
      ? "The agent could not complete this run safely. Please try again shortly."
      : "تعذّر تشغيل الوكيل الذكي حالياً. حاول مرة أخرى بعد قليل.";
  return {
    decision,
    confidence:
      typeof confidenceSemantics.displayValue === "number"
        ? confidenceSemantics.displayValue
        : 0,
    confidenceSemantics,
    summary,
    keyReasons: [reason],
    riskWarnings: [
      locale === "en"
        ? "No analytical WAIT was synthesized. This is a technical outcome, not a market wait decision."
        : "لم يُختلق قرار انتظار سوقي. هذه نتيجة تقنية وليست قرار انتظار تحليلي.",
    ],
    activityEvents,
    drawings: [],
  };
}

/** Informational answer to a general (non-trading) question. */
export function buildInformationalResult(
  summary: string,
  activityEvents: AgentActivityEvent[] = [],
  modelRun?: AgentFinalResult["modelRun"],
): AgentFinalResult {
  const confidenceSemantics = buildInformationalConfidence({
    analysisConfidence: 0,
  });
  return {
    decision: "informational",
    confidence: 0,
    confidenceSemantics,
    summary,
    keyReasons: [],
    riskWarnings: [],
    activityEvents,
    modelRun,
  };
}
