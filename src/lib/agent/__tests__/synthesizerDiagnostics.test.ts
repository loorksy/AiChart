import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { z } from "zod";
import { classifySynthesizerError } from "@/lib/agent/agents/finalDecisionSynthesizer";
import { buildAgentFallbackResult } from "@/lib/agent/fallback";

describe("synthesizer failure classification", () => {
  it("separates permanent configuration faults from transient ones", () => {
    const auth = classifySynthesizerError(
      new Error("خطأ من gpt-5.6 (HTTP 401): invalid api key"),
    );
    assert.equal(auth.kind, "provider_auth");
    assert.equal(auth.retryable, false, "retrying a bad key is pointless");

    const rateLimit = classifySynthesizerError(new Error("HTTP 429 rate limit exceeded"));
    assert.equal(rateLimit.kind, "provider_rate_limit");
    assert.equal(rateLimit.retryable, true);

    const unavailable = classifySynthesizerError(new Error("خطأ من النموذج (HTTP 503)"));
    assert.equal(unavailable.kind, "provider_unavailable");
    assert.equal(unavailable.retryable, true);
  });

  it("recognises network and deadline faults", () => {
    assert.equal(classifySynthesizerError(new Error("fetch failed")).kind, "network");
    assert.equal(
      classifySynthesizerError(new Error("The operation was aborted")).kind,
      "timeout",
    );
    assert.equal(classifySynthesizerError(new Error("رد فارغ من gpt-5.6")).kind, "empty_response");
  });

  it("distinguishes malformed JSON from a schema mismatch", () => {
    const badJson = classifySynthesizerError(new SyntaxError("Unexpected token < in JSON"));
    assert.equal(badJson.kind, "invalid_json");
    assert.equal(badJson.retryable, true);

    const schema = z.object({ decision: z.enum(["buy", "sell", "wait"]) });
    const parsed = schema.safeParse({ decision: "maybe" });
    assert.equal(parsed.success, false);
    const mismatch = classifySynthesizerError(parsed.error);
    assert.equal(mismatch.kind, "schema_mismatch");
    assert.equal(mismatch.retryable, true);
    assert.match(mismatch.detail, /decision/);
  });

  it("never claims an unknown fault is retryable", () => {
    const unknown = classifySynthesizerError(new Error("something entirely new"));
    assert.equal(unknown.kind, "unknown");
    assert.equal(unknown.retryable, false);
    assert.match(unknown.detail, /something entirely new/);
  });
});

describe("fallback keeps the raw provider cause off the user surface", () => {
  // RELIABILITY_PLAN.md item 7: the user-facing summary/keyReasons must carry
  // the safe, localized taxonomy message only — never the raw provider payload
  // (which can embed an API key, an internal URL, or a stack fragment). The
  // machine cause lives in envelope.failure_code; operators read the raw text
  // from server logs, correlated by trace_id.
  it("uses the safe localized taxonomy message, never the raw detail", () => {
    const rate = buildAgentFallbackResult("operator reason", [], "ar", {
      detail: "HTTP 429 rate limit exceeded",
      failureCode: "rate_limit",
      retryable: true,
    });
    assert.match(rate.summary, /مزوّد الخدمة مشغول/);
    assert.doesNotMatch(rate.summary, /HTTP 429/);
    assert.equal(rate.envelope?.failure_code, "rate_limit");
    assert.equal(rate.envelope?.retryable, true);
  });

  it("never leaks a provider key or URL on an auth fault", () => {
    const auth = buildAgentFallbackResult(
      "Decision model failed (provider_auth, 1 attempt(s)): Incorrect API key provided: sk-abc123",
      [],
      "ar",
      { detail: "Incorrect API key provided: sk-abc123", failureCode: "auth", retryable: false },
    );
    assert.doesNotMatch(auth.summary, /sk-/);
    assert.doesNotMatch(auth.summary, /Incorrect API key/i);
    // keyReasons is user-rendered — it must not carry the raw cause either.
    assert.deepEqual(auth.keyReasons, []);
    assert.equal(auth.envelope?.failure_code, "auth");
    assert.equal(auth.envelope?.retryable, false);
  });

  it("localizes the safe message for English without the raw detail", () => {
    const en = buildAgentFallbackResult("op", [], "en", {
      detail: "provider unavailable — internal socket detail",
      failureCode: "provider_unavailable",
      retryable: true,
    });
    assert.match(en.summary, /temporarily unavailable/i);
    assert.doesNotMatch(en.summary, /internal socket detail/);
  });

  it("carries the machine-readable cause in envelope.failure_code, not keyReasons", () => {
    const result = buildAgentFallbackResult(
      "Decision model failed (provider_auth, 1 attempt(s)): bad key",
      [],
      "ar",
      { detail: "bad key", failureCode: "auth", retryable: false },
    );
    assert.deepEqual(result.keyReasons, []);
    assert.equal(result.envelope?.failure_code, "auth");
  });

  it("falls back to the generic unknown message when no code is given", () => {
    const result = buildAgentFallbackResult("reason", [], "ar");
    assert.match(result.summary, /تعذّر إكمال الطلب/);
    assert.equal(result.decision, "informational");
    assert.deepEqual(result.drawings, []);
    assert.equal(result.envelope?.failure_code, "unknown");
  });
});
