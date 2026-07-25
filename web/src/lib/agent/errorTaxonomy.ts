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
import type { AppLocale } from "@/lib/i18n";
import type { SynthesizerFailureKind } from "./agents/finalDecisionSynthesizer";

export type AgentFailureCode =
  | "auth"
  | "rate_limit"
  | "timeout"
  | "network"
  | "provider_unavailable"
  | "invalid_payload"
  | "schema_mismatch"
  | "stale_data"
  | "insufficient_data"
  | "artifact_missing"
  | "resource_exhausted"
  | "cancelled"
  | "configuration"
  | "unknown";

/** Pipeline stages a failure can be attributed to. */
export type AgentStage =
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
  if (/\b429\b/.test(message) || lower.includes("rate limit") || lower.includes("quota")) {
    return { code: "rate_limit", retryable: true, detail: message };
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

/** Safe, localized user-facing sentence for a failure code. No internals. */
export function userMessageForFailure(
  code: AgentFailureCode,
  locale: AppLocale,
): string {
  const ar: Record<AgentFailureCode, string> = {
    auth: "لا يمكن الاتصال بمزوّد الخدمة بسبب مشكلة صلاحيات — تحتاج مراجعة الإعداد.",
    rate_limit: "مزوّد الخدمة مشغول حالياً — أعد المحاولة بعد قليل.",
    timeout: "استغرقت العملية وقتاً أطول من المسموح — أعد المحاولة بعد قليل.",
    network: "تعذّر الاتصال بالشبكة — أعد المحاولة بعد قليل.",
    provider_unavailable: "مزوّد الخدمة غير متاح مؤقتاً — أعد المحاولة بعد قليل.",
    invalid_payload: "وصل رد غير صالح من مزوّد الخدمة — أعد المحاولة بعد قليل.",
    schema_mismatch: "رد النموذج لا يطابق العقد المتوقع — أعد المحاولة بعد قليل.",
    stale_data: "الأسعار المتاحة ليست حديثة بما يكفي لقرار موثوق — انتظر ثوانٍ ثم أعد المحاولة.",
    insufficient_data: "البيانات التاريخية المتاحة غير كافية لإكمال هذا التحليل.",
    artifact_missing: "نتيجة مطلوبة غير موجودة — تحتاج مراجعة تشغيلية.",
    resource_exhausted: "الموارد التشغيلية ممتلئة مؤقتاً — أعد المحاولة بعد قليل.",
    cancelled: "أُلغي الطلب قبل اكتماله.",
    configuration: "هناك إعداد ناقص على الخادم — هذه المشكلة لن تُحل بإعادة المحاولة.",
    unknown: "حدث خطأ غير متوقع أثناء التحليل.",
  };
  const en: Record<AgentFailureCode, string> = {
    auth: "Cannot reach the service provider due to an authorization problem — the configuration needs review.",
    rate_limit: "The service provider is busy right now — try again shortly.",
    timeout: "The operation took longer than allowed — try again shortly.",
    network: "A network connection problem occurred — try again shortly.",
    provider_unavailable: "The service provider is temporarily unavailable — try again shortly.",
    invalid_payload: "An invalid response arrived from the service provider — try again shortly.",
    schema_mismatch: "The model reply did not match the expected contract — try again shortly.",
    stale_data: "Available prices are not fresh enough for a reliable decision — wait a few seconds and retry.",
    insufficient_data: "The available historical data is not enough to complete this analysis.",
    artifact_missing: "A required result is missing — operational review needed.",
    resource_exhausted: "Operational resources are temporarily exhausted — try again shortly.",
    cancelled: "The request was cancelled before completion.",
    configuration: "A server-side configuration is missing — retrying will not help.",
    unknown: "An unexpected error occurred during analysis.",
  };
  return locale === "en" ? en[code] : ar[code];
}
