/**
 * Fallback results. When the agent can't complete safely, the UI must still get
 * a well-formed result with NO trade recommendation — never a crash, never an
 * invented analysis. These are protocol-failure messages (allowed to be
 * static) but they still respect the operator's language.
 */
import type { AppLocale } from "@/lib/i18n";
import {
  buildInformationalConfidence,
} from "./confidenceSemantics";
import type { AgentActivityEvent, AgentFinalResult } from "./types";

/**
 * Generic partial-failure fallback: informational, no market decision.
 *
 * `options.detail` carries the ACTUAL cause (provider auth, rate limit,
 * malformed model reply, deadline) into the operator-visible summary. The old
 * behaviour buried every distinct fault under one "try again shortly" line,
 * which made production failures impossible to triage from the outside.
 */
export function buildAgentFallbackResult(
  reason: string,
  activityEvents: AgentActivityEvent[] = [],
  locale: AppLocale = "ar",
  options: { detail?: string; retryable?: boolean } = {},
): AgentFinalResult {
  const confidenceSemantics = buildInformationalConfidence({ analysisConfidence: 0 });
  const detail = options.detail?.trim();
  const retryHintAr = options.retryable
    ? " أعد المحاولة بعد قليل."
    : " هذه المشكلة لن تُحل بإعادة المحاولة — راجع الإعداد.";
  const retryHintEn = options.retryable
    ? " Please try again shortly."
    : " Retrying will not help — check the configuration.";
  const summary =
    locale === "en"
      ? detail
        ? `The agent could not complete this run: ${detail}${retryHintEn}`
        : "The agent could not complete this run safely. Please try again shortly."
      : detail
        ? `تعذّر إكمال التحليل: ${detail}${retryHintAr}`
        : "تعذّر تشغيل الوكيل الذكي حالياً. حاول مرة أخرى بعد قليل.";
  return {
    decision: "informational",
    confidence:
      typeof confidenceSemantics.displayValue === "number"
        ? confidenceSemantics.displayValue
        : 0,
    confidenceSemantics,
    summary,
    keyReasons: [reason],
    riskWarnings: [
      locale === "en"
        ? "No trade recommendation was issued due to a partial system failure."
        : "لم يتم إصدار توصية تداول بسبب فشل جزئي في النظام.",
    ],
    activityEvents,
    drawings: [],
  };
}

/** Informational answer to a general (non-trading) question. */
export function buildInformationalResult(
  summary: string,
  activityEvents: AgentActivityEvent[] = [],
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
  };
}
