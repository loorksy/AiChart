/**
 * Fallback results. When the agent can't complete safely, the UI must still get
 * a well-formed result with NO trade recommendation — never a crash, never an
 * invented analysis. These are protocol-failure messages (allowed to be
 * static) but they still respect the operator's language.
 *
 * Contract note: a partial-failure fallback is an OPERATIONAL BLOCKER, not a
 * descriptive answer — its envelope says so explicitly so clients can stop
 * guessing whether "informational" meant analysis or fault.
 */
import type { AppLocale } from "@/lib/i18n";
import {
  buildInformationalConfidence,
} from "./confidenceSemantics";
import type { AgentActivityEvent, AgentFinalResult } from "./types";
import {
  classifyAgentError,
  isRetryableFailureCode,
  userMessageForFailure,
  type AgentFailureCode,
  type AgentStage,
} from "./errorTaxonomy";
import {
  descriptiveEnvelope,
  operationalBlockerEnvelope,
} from "./resultEnvelope";

/**
 * Generic partial-failure fallback: informational, no market decision.
 *
 * User/operator separation (RELIABILITY_PLAN.md item 7): the user-facing
 * `summary` is ALWAYS the safe, localized taxonomy message for the failure
 * code — it NEVER carries the raw provider payload (which may embed an API
 * key, an internal URL, or a stack fragment). The raw cause (`reason` /
 * `options.detail`) is operator-only: callers log it server-side and every
 * result carries a `trace_id` so a support request correlates the two. The
 * machine-readable code lives in `envelope.failure_code`, never in
 * user-rendered `keyReasons`.
 */
export function buildAgentFallbackResult(
  // Operator/machine cause. Retained for call-site readability + backwards
  // compatibility; INTENTIONALLY never rendered to the user (see above).
  reason: string,
  activityEvents: AgentActivityEvent[] = [],
  locale: AppLocale = "ar",
  options: {
    /** Operator-only raw cause. Never interpolated into the user summary. */
    detail?: string;
    retryable?: boolean;
    /** Pipeline stage the failure is attributed to (envelope.failure_stage). */
    failureStage?: AgentStage;
    /** Taxonomy code for the failure (envelope.failure_code). */
    failureCode?: AgentFailureCode;
    /** Correlation id surfaced to the user for support (request id). */
    traceId?: string;
    /**
     * Stages that did not finish. Named in the user summary, because the
     * doctrine asks for the blocker AND its cause — and "took too long" is
     * neither. Safe to surface: these are pipeline stage ids translated
     * through the same labels the run checklist already shows.
     */
    degradedStages?: readonly string[];
  } = {},
): AgentFinalResult {
  const confidenceSemantics = buildInformationalConfidence({ analysisConfidence: 0 });
  const failureCode = options.failureCode ?? "unknown";
  const retryable = options.retryable ?? isRetryableFailureCode(failureCode);
  // Safe, localized, code-specific message — the ONLY thing the user sees.
  const safeMessage = userMessageForFailure(failureCode, locale, {
    stages: options.degradedStages,
  });
  const summary =
    locale === "en"
      ? `The request could not be completed. ${safeMessage}`
      : `تعذّر إكمال الطلب. ${safeMessage}`;
  return {
    decision: "informational",
    // Server-only: the machine cause, carried to the audit writer so a Request
    // ID resolves to WHY it failed. Stripped before the result reaches the
    // browser (stripInternalFieldsFromClientResult) — the user still sees only
    // the safe, code-specific sentence above.
    operatorFailureDetail: (options.detail ?? reason)?.slice(0, 500),
    envelope: operationalBlockerEnvelope({
      failureStage: options.failureStage ?? "final_decision",
      failureCode,
      retryable,
      traceId: options.traceId,
    }),
    confidence:
      typeof confidenceSemantics.displayValue === "number"
        ? confidenceSemantics.displayValue
        : 0,
    confidenceSemantics,
    summary,
    // Machine cause is in envelope.failure_code + operator logs — not here.
    keyReasons: [],
    riskWarnings: [
      locale === "en"
        ? "No trade recommendation was issued due to a partial system failure."
        : "لم يتم إصدار توصية تداول بسبب فشل جزئي في النظام.",
    ],
    activityEvents,
    drawings: [],
  };
}

/**
 * A greeting / account-help / general question whose LLM call failed.
 *
 * Provider faults must stay an operational blocker with the real taxonomy
 * code — never a `descriptive_only` "try again" card.
 */
export function resultForGeneralQuestionFailure(
  error: unknown,
  activityEvents: AgentActivityEvent[] = [],
  locale: AppLocale = "ar",
  options: { traceId?: string } = {},
): AgentFinalResult {
  const classified = classifyAgentError(error);
  return buildAgentFallbackResult(classified.detail, activityEvents, locale, {
    failureStage: "general",
    failureCode: classified.code,
    retryable: classified.retryable,
    traceId: options.traceId,
    detail: classified.detail,
  });
}

/** Informational answer to a general (non-trading) question. */
export function buildInformationalResult(
  summary: string,
  activityEvents: AgentActivityEvent[] = [],
  options: { traceId?: string } = {},
): AgentFinalResult {
  const confidenceSemantics = buildInformationalConfidence({
    analysisConfidence: 0,
  });
  return {
    decision: "informational",
    envelope: descriptiveEnvelope({ traceId: options.traceId }),
    confidence: 0,
    confidenceSemantics,
    summary,
    keyReasons: [],
    riskWarnings: [],
    activityEvents,
  };
}
