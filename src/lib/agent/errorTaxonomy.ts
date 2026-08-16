/**
 * Unified error taxonomy for every agent stage and provider call.
 *
 * The Final Decision Synthesizer already classifies its own failures
 * (auth / rate limit / timeout / malformed JSON…). This module generalizes
 * that contract to ALL stages so a specialist or data-source fault is never
 * reduced to a silent `null` — the cause survives into the result envelope,
 * activity events, and operator logs.
 *
 * Two audiences, strictly separated:
 * - `operatorDetail`: technical cause for logs/traces. Never shown in chat.
 * - `userMessageFor(...)`: a safe, localized sentence for the operator UI.
 *   It never carries provider payloads, keys, or internal module names.
 */
import { t, type AppLocale } from "@/lib/i18n";
import type { SynthesizerFailureKind } from "./agents/finalDecisionSynthesizer";

export type AgentFailureCode =
  | "auth"
  | "rate_limit"
  | "timeout"
  | "network"
  | "provider_unavailable"
  /** Provider rejected the request itself (HTTP 4xx): bad model id, unsupported parameter, oversized context. */
  | "provider_bad_request"
  /** The provider account is out of credit / over its billing quota. Retrying never helps. */
  | "provider_billing"
  | "invalid_payload"
  | "schema_mismatch"
  | "stale_data"
  /** The instrument's session is closed — no tape to read, not a fault. */
  | "insufficient_data"
  | "artifact_missing"
  | "resource_exhausted"
  | "cancelled"
  | "configuration"
  | "unknown";

/** Pipeline stages a failure can be attributed to. */
export type AgentStage =
  | "general"
  | "market_data"
  | "structure"
  | "liquidity"
  | "supply_demand"
  | "multi_timeframe"
  | "news"
  | "risk"
  | "final_decision"
  | "drawing"
  | "execution_guard"
  | "research"
  | "transport";

export interface AgentStageFailure {
  stage: AgentStage;
  code: AgentFailureCode;
  retryable: boolean;
  /** Technical cause for logs/traces only — never rendered in chat. */
  operatorDetail: string;
  provider?: string;
}

const RETRYABLE_CODES: ReadonlySet<AgentFailureCode> = new Set([
  "rate_limit",
  "timeout",
  "network",
  "provider_unavailable",
  "stale_data",
  "resource_exhausted",
]);

export function isRetryableFailureCode(code: AgentFailureCode): boolean {
  return RETRYABLE_CODES.has(code);
}

/**
 * Classify a raw thrown error into a taxonomy code. Mirrors (and extends) the
 * synthesizer's message-sniffing rules so every stage shares one vocabulary.
 */
export function classifyAgentError(error: unknown): {
  code: AgentFailureCode;
  retryable: boolean;
  detail: string;
} {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();

  if (error instanceof SyntaxError) {
    return { code: "invalid_payload", retryable: true, detail: message };
  }
  // AbortError from an AbortSignal is a deliberate cancellation, not a fault.
  if (
    (error instanceof Error && error.name === "AbortError") ||
    lower.includes("operation was aborted")
  ) {
    return { code: "cancelled", retryable: false, detail: message };
  }
  if (/\b(401|403)\b/.test(message) || lower.includes("api key") || lower.includes("unauthorized") || message.includes("مفتاح")) {
    return { code: "auth", retryable: false, detail: message };
  }
  // Billing exhaustion arrives as a 429 but is NOT a transient rate limit:
  // telling the operator to "try again shortly" is wrong forever. Checked
  // before the rate-limit branch precisely because it shares the status code.
  if (
    lower.includes("no credits") ||
    lower.includes("insufficient_quota") ||
    lower.includes("insufficient quota") ||
    lower.includes("exceeded your current quota") ||
    lower.includes("billing")
  ) {
    return { code: "provider_billing", retryable: false, detail: message };
  }
  if (/\b429\b/.test(message) || lower.includes("rate limit") || lower.includes("quota")) {
    return { code: "rate_limit", retryable: true, detail: message };
  }
  // Provider-side request rejections. Before this branch existed, an OpenAI 400
  // (bad model id, unsupported parameter, context overflow) fell through to
  // "unknown" and surfaced as "unexpected error — retrying won't help" with no
  // hint that the model configuration was the problem.
  if (
    /\b(400|404|409|413|422)\b/.test(message) ||
    lower.includes("bad request") ||
    lower.includes("does not exist") ||
    lower.includes("context length") ||
    lower.includes("maximum context") ||
    lower.includes("unsupported parameter")
  ) {
    return { code: "provider_bad_request", retryable: false, detail: message };
  }
  if (/\b(500|502|503|504)\b/.test(message) || lower.includes("overloaded") || lower.includes("unavailable")) {
    return { code: "provider_unavailable", retryable: true, detail: message };
  }
  if (lower.includes("timeout") || lower.includes("timed out") || lower.includes("deadline")) {
    return { code: "timeout", retryable: true, detail: message };
  }
  if (
    lower.includes("fetch failed") ||
    lower.includes("econnreset") ||
    lower.includes("econnrefused") ||
    lower.includes("enotfound") ||
    lower.includes("socket hang up")
  ) {
    return { code: "network", retryable: true, detail: message };
  }
  if (lower.includes("stale")) {
    return { code: "stale_data", retryable: true, detail: message };
  }
  if (lower.includes("insufficient") || lower.includes("not enough") || lower.includes("missing candles")) {
    return { code: "insufficient_data", retryable: false, detail: message };
  }
  if (lower.includes("enospc") || lower.includes("disk is full") || lower.includes("out of memory")) {
    return { code: "resource_exhausted", retryable: true, detail: message };
  }
  if (lower.includes("not configured") || lower.includes("missing env") || lower.includes("misconfig")) {
    return { code: "configuration", retryable: false, detail: message };
  }
  return { code: "unknown", retryable: false, detail: message };
}

/** Build a stage failure from a thrown error (classification included). */
export function stageFailureFromError(
  stage: AgentStage,
  error: unknown,
  provider?: string,
): AgentStageFailure {
  const classified = classifyAgentError(error);
  return {
    stage,
    code: classified.code,
    retryable: classified.retryable,
    operatorDetail: classified.detail.slice(0, 500),
    provider,
  };
}

/** Build a stage failure for a deadline hit (withTimeout resolved to fallback). */
export function stageTimeoutFailure(stage: AgentStage, deadlineMs: number): AgentStageFailure {
  return {
    stage,
    code: "timeout",
    retryable: true,
    operatorDetail: `Stage exceeded its ${Math.round(deadlineMs / 1000)}s deadline.`,
  };
}

/**
 * Ledger a SILENT stage deadline. `withTimeout` resolves to the fallback
 * (null) without throwing, so the capture catch never fires — without this,
 * a run whose specialists all timed out would still claim operational_status
 * "ok". A null value with no thrown-failure entry for the stage can only mean
 * the deadline hit.
 */
export function ledgerSilentTimeout(
  failures: AgentStageFailure[],
  stage: AgentStage,
  value: unknown,
  deadlineMs: number,
): void {
  if (value != null) return;
  if (failures.some((f) => f.stage === stage)) return;
  failures.push(stageTimeoutFailure(stage, deadlineMs));
}

/** Map the synthesizer's existing failure kinds onto the shared taxonomy. */
export function failureCodeFromSynthesizerKind(
  kind: SynthesizerFailureKind,
): AgentFailureCode {
  switch (kind) {
    case "llm_not_configured":
      return "configuration";
    case "provider_auth":
      return "auth";
    case "provider_rate_limit":
      return "rate_limit";
    case "provider_unavailable":
      return "provider_unavailable";
    case "provider_bad_request":
      return "provider_bad_request";
    case "provider_billing":
      return "provider_billing";
    case "timeout":
      return "timeout";
    case "network":
      return "network";
    case "empty_response":
      return "invalid_payload";
    case "invalid_json":
      return "invalid_payload";
    case "schema_mismatch":
      return "schema_mismatch";
    default:
      return "unknown";
  }
}

/**
 * The stages that did not finish, named in the operator's language.
 *
 * Stage ids are internal, so they are translated through the same
 * `agent.stage.*` keys the run checklist uses rather than printed raw — the
 * operator sees the localized stage name, not "market_data".
 */
function namedStages(stages: readonly string[], locale: AppLocale): string {
  const seen = [...new Set(stages.filter((stage) => stage.trim()))];
  if (!seen.length) return "";
  return seen
    .map((stage) => t(locale, `agent.stage.${stage}`))
    .join(t(locale, "list.separator"));
}

/**
 * Safe, localized user-facing sentence for a failure code. No internals.
 *
 * `cause.stages` turns the generic sentence into the one the doctrine actually
 * requires. "The operation took longer than allowed" names neither the blocker
 * nor its cause, so an operator hitting it — and the person debugging it —
 * learned nothing beyond a request id. The orchestrator already tracks which
 * stages degraded; this is where that knowledge reaches the reader.
 */
export function userMessageForFailure(
  code: AgentFailureCode,
  locale: AppLocale,
  cause?: { stages?: readonly string[] },
): string {
  const stages = cause?.stages?.length ? namedStages(cause.stages, locale) : "";
  // Timeout and insufficient_data both carry stage ids, but they are different
  // faults. Folding insufficient_data into the "did not finish in time"
  // sentence made coverage/gap blockers look like MetaApi deadlines — which is
  // exactly the "market data did not finish within the deadline" operators
  // kept seeing when the warehouse was simply thin.
  if (stages && code === "timeout") {
    return t(locale, "fault.timeout_stages", { stages });
  }
  if (stages && code === "insufficient_data") {
    return t(locale, "fault.insufficient_data_stages", { stages });
  }
  return t(locale, `fault.${code}`);
}
