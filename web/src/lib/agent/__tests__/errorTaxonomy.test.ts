import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifyAgentError,
  failureCodeFromSynthesizerKind,
  isRetryableFailureCode,
  ledgerSilentTimeout,
  stageFailureFromError,
  stageTimeoutFailure,
  userMessageForFailure,
  type AgentStageFailure,
} from "@/lib/agent/errorTaxonomy";

describe("classifyAgentError", () => {
  it("separates permanent auth faults from transient provider faults", () => {
    const auth = classifyAgentError(new Error("HTTP 401: invalid api key"));
    assert.equal(auth.code, "auth");
    assert.equal(auth.retryable, false);

    const rate = classifyAgentError(new Error("HTTP 429 rate limit exceeded"));
    assert.equal(rate.code, "rate_limit");
    assert.equal(rate.retryable, true);

    const unavailable = classifyAgentError(new Error("HTTP 503 service overloaded"));
    assert.equal(unavailable.code, "provider_unavailable");
    assert.equal(unavailable.retryable, true);
  });

  it("recognises network, timeout, and cancellation separately", () => {
    assert.equal(classifyAgentError(new Error("fetch failed")).code, "network");
    assert.equal(classifyAgentError(new Error("ECONNRESET while reading")).code, "network");
    assert.equal(classifyAgentError(new Error("request timed out after 10s")).code, "timeout");

    const abort = new Error("The operation was aborted");
    abort.name = "AbortError";
    const cancelled = classifyAgentError(abort);
    assert.equal(cancelled.code, "cancelled");
    assert.equal(cancelled.retryable, false, "a deliberate cancel is not a retry hint");
  });

  it("recognises data-quality and resource faults", () => {
    assert.equal(classifyAgentError(new Error("candles are stale for XAUUSD")).code, "stale_data");
    assert.equal(
      classifyAgentError(new Error("insufficient history: 39 bars")).code,
      "insufficient_data",
    );
    assert.equal(
      classifyAgentError(new Error("SQLITE_FULL: database or disk is full")).code,
      "resource_exhausted",
    );
    assert.equal(
      classifyAgentError(new Error("news provider not configured")).code,
      "configuration",
    );
  });

  it("treats malformed payloads as retryable invalid_payload", () => {
    const bad = classifyAgentError(new SyntaxError("Unexpected token <"));
    assert.equal(bad.code, "invalid_payload");
    assert.equal(bad.retryable, true);
  });

  it("never claims an unknown fault is retryable", () => {
    const unknown = classifyAgentError(new Error("something entirely new"));
    assert.equal(unknown.code, "unknown");
    assert.equal(unknown.retryable, false);
  });
});

describe("stage failures", () => {
  it("stamps the stage and truncates operator detail", () => {
    const failure = stageFailureFromError("structure", new Error("x".repeat(900)));
    assert.equal(failure.stage, "structure");
    assert.ok(failure.operatorDetail.length <= 500);
  });

  it("builds a retryable timeout failure for a stage deadline", () => {
    const failure = stageTimeoutFailure("news", 8000);
    assert.equal(failure.stage, "news");
    assert.equal(failure.code, "timeout");
    assert.equal(failure.retryable, true);
    assert.match(failure.operatorDetail, /8s/);
  });

  it("ledgers a SILENT deadline (null value, no thrown failure) exactly once", () => {
    const failures: AgentStageFailure[] = [];
    ledgerSilentTimeout(failures, "structure", null, 5000);
    assert.equal(failures.length, 1);
    assert.equal(failures[0]!.stage, "structure");
    assert.equal(failures[0]!.code, "timeout");

    // A successful stage (non-null) is never ledgered.
    ledgerSilentTimeout(failures, "liquidity", { ok: true }, 5000);
    assert.equal(failures.length, 1);

    // A stage that already has a THROWN failure keeps the real cause.
    failures.push(stageFailureFromError("news", new Error("HTTP 429 rate limit")));
    ledgerSilentTimeout(failures, "news", null, 8000);
    assert.equal(failures.filter((f) => f.stage === "news").length, 1);
    assert.equal(failures.find((f) => f.stage === "news")!.code, "rate_limit");
  });
});

describe("synthesizer kind mapping", () => {
  it("maps every synthesizer kind onto the shared taxonomy", () => {
    assert.equal(failureCodeFromSynthesizerKind("provider_auth"), "auth");
    assert.equal(failureCodeFromSynthesizerKind("provider_rate_limit"), "rate_limit");
    assert.equal(failureCodeFromSynthesizerKind("provider_unavailable"), "provider_unavailable");
    assert.equal(failureCodeFromSynthesizerKind("timeout"), "timeout");
    assert.equal(failureCodeFromSynthesizerKind("network"), "network");
    assert.equal(failureCodeFromSynthesizerKind("invalid_json"), "invalid_payload");
    assert.equal(failureCodeFromSynthesizerKind("empty_response"), "invalid_payload");
    assert.equal(failureCodeFromSynthesizerKind("schema_mismatch"), "schema_mismatch");
    assert.equal(failureCodeFromSynthesizerKind("llm_not_configured"), "configuration");
    assert.equal(failureCodeFromSynthesizerKind("unknown"), "unknown");
  });
});

describe("user-facing failure messages", () => {
  it("localizes without leaking internals", () => {
    const ar = userMessageForFailure("rate_limit", "ar");
    assert.match(ar, /أعد المحاولة/);
    const en = userMessageForFailure("auth", "en");
    assert.match(en, /authorization/i);
    // No stack traces, provider names, or module names in any message.
    for (const code of [
      "auth",
      "rate_limit",
      "timeout",
      "network",
      "provider_unavailable",
      "invalid_payload",
      "schema_mismatch",
      "stale_data",
      "insufficient_data",
      "artifact_missing",
      "resource_exhausted",
      "cancelled",
      "configuration",
      "unknown",
    ] as const) {
      const msg = userMessageForFailure(code, "en");
      assert.doesNotMatch(msg, /OANDA|openai|gpt|stack|Error:/i);
    }
  });

  it("retryability matches the message hint", () => {
    assert.equal(isRetryableFailureCode("rate_limit"), true);
    assert.equal(isRetryableFailureCode("auth"), false);
    assert.equal(isRetryableFailureCode("configuration"), false);
    assert.equal(isRetryableFailureCode("cancelled"), false);
  });
});
