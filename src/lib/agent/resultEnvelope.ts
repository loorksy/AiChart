/**
 * Result Envelope — the three-state outcome contract every direct request
 * must end with (RELIABILITY_PLAN.md, item 1):
 *
 * - `execution_validated`: a statistically-backed, execution-grade answer.
 * - `descriptive_only`: a complete market answer with NO execution authority.
 * - `operational_blocker`: an honest report that analysis could not happen.
 *
 * The envelope is ADDITIVE: `decision` and every legacy field stay untouched
 * so existing clients keep working. New clients read `envelope` first.
 * A blocker envelope always states explicitly that no recommendation was
 * issued — a client can never mistake a fault for a WAIT.
 */
import type { AgentFailureCode, AgentStage, AgentStageFailure } from "./errorTaxonomy";

export const RESULT_ENVELOPE_VERSION = "1.0.0";

export type OutcomeClass =
  | "execution_validated"
  | "descriptive_only"
  | "operational_blocker";

export type RecommendationAuthority = "validated" | "descriptive" | "none";

/** How much verified historical evidence backs this answer. */
export type EvidenceStatus = "validated" | "partial" | "insufficient" | "none";

export type OperationalStatus = "ok" | "degraded" | "blocked" | "cancelled";

/** Always-visible execution mode badge (RELIABILITY_PLAN.md, item 11 → phase 0). */
export type ExecutionMode = "descriptive" | "shadow" | "demo" | "live";

export interface ResultEnvelope {
  version: string;
  outcome_class: OutcomeClass;
  recommendation_authority: RecommendationAuthority;
  evidence_status: EvidenceStatus;
  operational_status: OperationalStatus;
  execution_mode: ExecutionMode;
  /** Explicit: did this response include a trade recommendation? */
  recommendation_issued: boolean;
  /** Present on blockers (and meaningful degradations). */
  retryable?: boolean;
  failure_stage?: AgentStage;
  failure_code?: AgentFailureCode;
  /**
   * WHICH provider produced a provider-class failure ("openai"/"anthropic").
   * Without it the message can only say "the AI provider", which is what led
   * an operator to top up the account that was not the failing one.
   */
  failure_provider?: string;
  /** Stages that failed but were degraded around (answer still stands). */
  degraded_stages?: AgentStage[];
  /** Correlation id (request id) for support/observability. Not a secret. */
  trace_id?: string;
  /** Operator-visible market book for this answer (platform OANDA feed). */
  market_data_source?: string;
  /** Numeric levels cited in the visible answer (support/resistance, plan). */
  key_price_levels?: number[];
}

export function operationalBlockerEnvelope(opts: {
  failureStage: AgentStage;
  failureCode: AgentFailureCode;
  retryable: boolean;
  traceId?: string;
  degradedStages?: AgentStage[];
  cancelled?: boolean;
  failureProvider?: string;
}): ResultEnvelope {
  return {
    version: RESULT_ENVELOPE_VERSION,
    outcome_class: "operational_blocker",
    recommendation_authority: "none",
    evidence_status: "none",
    operational_status: opts.cancelled ? "cancelled" : "blocked",
    execution_mode: "descriptive",
    recommendation_issued: false,
    retryable: opts.retryable,
    failure_stage: opts.failureStage,
    failure_code: opts.failureCode,
    ...(opts.failureProvider ? { failure_provider: opts.failureProvider } : {}),
    ...(opts.degradedStages?.length ? { degraded_stages: opts.degradedStages } : {}),
    ...(opts.traceId ? { trace_id: opts.traceId } : {}),
  };
}

export function descriptiveEnvelope(opts: {
  recommendationIssued?: boolean;
  evidenceStatus?: EvidenceStatus;
  traceId?: string;
  degradedStages?: AgentStage[];
} = {}): ResultEnvelope {
  const degraded = opts.degradedStages?.length ? opts.degradedStages : undefined;
  return {
    version: RESULT_ENVELOPE_VERSION,
    outcome_class: "descriptive_only",
    recommendation_authority: opts.recommendationIssued ? "descriptive" : "none",
    evidence_status: opts.evidenceStatus ?? "none",
    operational_status: degraded ? "degraded" : "ok",
    execution_mode: "descriptive",
    recommendation_issued: Boolean(opts.recommendationIssued),
    ...(degraded ? { degraded_stages: degraded } : {}),
    ...(opts.traceId ? { trace_id: opts.traceId } : {}),
  };
}

export function executionValidatedEnvelope(opts: {
  executionMode: Exclude<ExecutionMode, "descriptive">;
  traceId?: string;
  degradedStages?: AgentStage[];
}): ResultEnvelope {
  const degraded = opts.degradedStages?.length ? opts.degradedStages : undefined;
  return {
    version: RESULT_ENVELOPE_VERSION,
    outcome_class: "execution_validated",
    recommendation_authority: "validated",
    evidence_status: "validated",
    operational_status: degraded ? "degraded" : "ok",
    execution_mode: opts.executionMode,
    recommendation_issued: true,
    ...(degraded ? { degraded_stages: degraded } : {}),
    ...(opts.traceId ? { trace_id: opts.traceId } : {}),
  };
}

/**
 * Envelope for the market-analysis final result. `execution_validated` is
 * granted ONLY when the recommendation is bound to server-verified deployment
 * evidence — a plain model BUY/SELL without validated history stays
 * descriptive. This mirrors requireRecommendationEvidence and never loosens it.
 */
export function envelopeForFinalDecision(opts: {
  actionableRecommendation: boolean;
  validatedEvidence: boolean;
  partialEvidence?: boolean;
  executionMode?: ExecutionMode;
  traceId?: string;
  degradedStages?: AgentStage[];
}): ResultEnvelope {
  if (opts.actionableRecommendation && opts.validatedEvidence) {
    return executionValidatedEnvelope({
      executionMode:
        opts.executionMode && opts.executionMode !== "descriptive"
          ? opts.executionMode
          : "shadow",
      traceId: opts.traceId,
      degradedStages: opts.degradedStages,
    });
  }
  return descriptiveEnvelope({
    recommendationIssued: opts.actionableRecommendation,
    evidenceStatus: opts.validatedEvidence
      ? "validated"
      : opts.partialEvidence
        ? "partial"
        : "insufficient",
    traceId: opts.traceId,
    degradedStages: opts.degradedStages,
  });
}

/** Degraded stage list from captured failures (stable order, deduped). */
export function degradedStagesFrom(
  failures: readonly AgentStageFailure[],
): AgentStage[] {
  return [...new Set(failures.map((f) => f.stage))];
}
