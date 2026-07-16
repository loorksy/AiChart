/**
 * Fallback results. When the agent can't complete safely, the UI must still get
 * a well-formed result with NO trade recommendation — never a crash, never an
 * invented analysis. These are protocol-failure messages (allowed to be
 * static) but they still respect the operator's language.
 */
import type { AppLocale } from "@/lib/i18n";
import {
  buildInformationalConfidence,
  buildWaitConfidence,
} from "./confidenceSemantics";
import type { AgentActivityEvent, AgentFinalResult } from "./types";

/** Generic partial-failure fallback: informational, WAIT, no drawings. */
export function buildAgentFallbackResult(
  reason: string,
  activityEvents: AgentActivityEvent[] = [],
  locale: AppLocale = "ar",
): AgentFinalResult {
  const confidenceSemantics = buildWaitConfidence({
    decisionConfidence: 0.9,
    dataQualityScore: 0.3,
    reasons: [reason],
    riskVeto: true,
  });
  return {
    decision: "informational",
    confidence:
      typeof confidenceSemantics.displayValue === "number"
        ? confidenceSemantics.displayValue
        : 0,
    confidenceSemantics,
    summary:
      locale === "en"
        ? "The agent could not complete this run safely. Please try again shortly."
        : "تعذّر تشغيل الوكيل الذكي حالياً. حاول مرة أخرى بعد قليل.",
    keyReasons: [reason],
    riskWarnings: [
      locale === "en"
        ? "No trade recommendation was issued due to a partial system failure."
        : "لم يتم إصدار توصية تداول بسبب فشل جزئي في النظام.",
    ],
    activityEvents,
    recommendation: { action: "wait" },
    drawings: [],
  };
}

/** Informational answer to a general (non-trading) question. */
export function buildInformationalResult(
  summary: string,
  activityEvents: AgentActivityEvent[] = [],
): AgentFinalResult {
  const confidenceSemantics = buildInformationalConfidence({
    analysisConfidence: 0.75,
  });
  return {
    decision: "informational",
    confidence: 0,
    confidenceSemantics,
    summary,
    keyReasons: [],
    riskWarnings: [],
    activityEvents,
  };
}
