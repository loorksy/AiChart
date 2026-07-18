/**
 * Technical / infrastructure outcomes that must never masquerade as WAIT.
 */
import type { AgentDecision } from "../types";

export type TechnicalAnalysisOutcome =
  | "data_unavailable"
  | "model_unavailable"
  | "model_timeout"
  | "invalid_model_output"
  | "analysis_failed"
  | "execution_unavailable"
  | "reanalysis_required";

export function isTechnicalAnalysisOutcome(
  decision: AgentDecision,
): decision is TechnicalAnalysisOutcome {
  return (
    decision === "data_unavailable" ||
    decision === "model_unavailable" ||
    decision === "model_timeout" ||
    decision === "invalid_model_output" ||
    decision === "analysis_failed" ||
    decision === "execution_unavailable" ||
    decision === "reanalysis_required"
  );
}

export function isAnalyticalMarketDecision(
  decision: AgentDecision,
): decision is "buy" | "sell" | "wait" {
  return decision === "buy" || decision === "sell" || decision === "wait";
}

export type ModelFirstFailureKind =
  | "missing_api_key"
  | "model_registry_unavailable"
  | "model_selection_invalid"
  | "candidate_authority_leak"
  | "timeout"
  | "invalid_model_output"
  | "empty_response"
  | "provider_error"
  | "canceled"
  | "unknown";

export function failureKindToDecision(
  kind: ModelFirstFailureKind,
): TechnicalAnalysisOutcome {
  switch (kind) {
    case "timeout":
      return "model_timeout";
    case "invalid_model_output":
    case "empty_response":
      return "invalid_model_output";
    case "missing_api_key":
    case "model_registry_unavailable":
    case "model_selection_invalid":
    case "provider_error":
      return "model_unavailable";
    case "candidate_authority_leak":
    case "canceled":
    case "unknown":
    default:
      return "analysis_failed";
  }
}
