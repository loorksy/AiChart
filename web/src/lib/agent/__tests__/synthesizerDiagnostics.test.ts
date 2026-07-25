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

describe("fallback surfaces the real cause", () => {
  it("keeps the legacy generic text when no detail is known", () => {
    const result = buildAgentFallbackResult("reason", [], "ar");
    assert.match(result.summary, /تعذّر تشغيل الوكيل الذكي حالياً/);
    assert.equal(result.decision, "informational");
    assert.deepEqual(result.drawings, []);
  });

  it("names the cause and whether retrying helps", () => {
    const retryable = buildAgentFallbackResult("r", [], "ar", {
      detail: "HTTP 429 rate limit exceeded",
      retryable: true,
    });
    assert.match(retryable.summary, /HTTP 429/);
    assert.match(retryable.summary, /أعد المحاولة/);

    const permanent = buildAgentFallbackResult("r", [], "ar", {
      detail: "مفتاح مزوّد الذكاء الاصطناعي غير مُعدّ",
      retryable: false,
    });
    assert.match(permanent.summary, /مفتاح/);
    assert.match(permanent.summary, /لن تُحل بإعادة المحاولة/);

    const english = buildAgentFallbackResult("r", [], "en", {
      detail: "provider unavailable",
      retryable: true,
    });
    assert.match(english.summary, /provider unavailable/);
    assert.match(english.summary, /try again/i);
  });

  it("carries the machine-readable reason in keyReasons for the run trace", () => {
    const result = buildAgentFallbackResult(
      "Decision model failed (provider_auth, 1 attempt(s)): bad key",
      [],
      "ar",
      { detail: "bad key", retryable: false },
    );
    assert.equal(result.keyReasons.length, 1);
    assert.match(result.keyReasons[0]!, /provider_auth/);
  });
});
