/**
 * Fallback results. When the agent can't complete safely, the UI must still get
 * a well-formed result with NO trade recommendation — never a crash, never an
 * invented analysis.
 */
import type { AgentActivityEvent, AgentFinalResult } from "./types";

/** Generic partial-failure fallback: informational, WAIT, no drawings. */
export function buildAgentFallbackResult(
  reason: string,
  activityEvents: AgentActivityEvent[] = [],
): AgentFinalResult {
  return {
    decision: "informational",
    confidence: 0,
    summary: "تعذّر تشغيل الوكيل الذكي حالياً. حاول مرة أخرى بعد قليل.",
    keyReasons: [reason],
    riskWarnings: ["لم يتم إصدار توصية تداول بسبب فشل جزئي في النظام."],
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
  return {
    decision: "informational",
    confidence: 0.8,
    summary,
    keyReasons: [],
    riskWarnings: [],
    activityEvents,
  };
}
