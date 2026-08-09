/**
 * Usage-accounting and result-labelling policy for market-analysis requests
 * (RELIABILITY_PLAN.md, item 8). Pure functions — unit-tested directly.
 */
import type { AgentDecision } from "./types";
import type { ResultEnvelope } from "./resultEnvelope";

/**
 * A full-analysis charge applies only when the platform actually produced an
 * analysis. An operational blocker (provider down, stale data, crash) is the
 * platform's failure — the operator is not billed for it.
 */
export function shouldChargeAnalysis(envelope: ResultEnvelope | undefined): boolean {
  if (!envelope) return true; // conservative: unknown envelope → legacy behaviour
  return envelope.outcome_class !== "operational_blocker";
}

/**
 * Qualitative reason for `recommendation: null` — a null must never be
 * ambiguous between "WAIT decision", "descriptive answer", and "fault".
 */
export function deriveRecommendationReason(
  decision: AgentDecision,
  envelope: ResultEnvelope | undefined,
): string {
  if (envelope?.outcome_class === "operational_blocker") {
    return `operational_blocker:${envelope.failure_code ?? "unknown"}`;
  }
  if (decision === "wait") return "wait_decision";
  if (decision === "action_required") return "action_required";
  return "descriptive_only";
}
