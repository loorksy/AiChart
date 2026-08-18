/**
 * Fault-injection matrix (RELIABILITY_PLAN.md item 10).
 *
 * These are the failure modes that actually took production down or produced
 * misleading answers. Each one asserts the SPECIFIC honest behaviour the plan
 * requires — not merely "does not crash":
 *   - a provider fault is classified, retried only when retrying can help, and
 *     never silently becomes a trading verdict;
 *   - a dead provider is failed fast instead of hammered;
 *   - a transport fault never marks live work dead;
 *   - the TS and Python sides cannot drift apart on shared thresholds.
 *
 * Scenarios already covered by dedicated suites are cross-referenced rather
 * than duplicated (see the coverage map at the bottom).
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  __resetResilience,
  breakerState,
  CircuitOpenError,
  isRetryableStatus,
  parseRetryAfterMs,
  resilientFetch,
} from "@/lib/providerResilience";
import { classifyAgentError, isRetryableFailureCode } from "@/lib/agent/errorTaxonomy";
import { isTransportFailure } from "@/lib/research/transportState";
import { ResearchServiceError } from "@/lib/research/errors";
import { MIN_BACKTEST_TRADES } from "@/lib/strategies/thresholds";

const realFetch = globalThis.fetch;

function mockFetch(handler: (url: string, init?: RequestInit) => Promise<Response> | Response) {
  globalThis.fetch = ((input: unknown, init?: RequestInit) =>
    Promise.resolve(handler(String(input), init))) as typeof fetch;
}

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers });
}

beforeEach(() => __resetResilience());
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("fault: market provider rate limit (429)", () => {
  it("retries and honours Retry-After instead of hammering", async () => {
    let calls = 0;
    mockFetch(() => {
      calls += 1;
      if (calls === 1) return jsonResponse(429, { error: "slow down" }, { "retry-after": "0" });
      return jsonResponse(200, { candles: [] });
    });
    const res = await resilientFetch("candles-test", "https://x.test/candles", {}, {
      maxRetries: 2,
      baseBackoffMs: 1,
      maxBackoffMs: 2,
    });
    assert.equal(res.status, 200, "a transient 429 must resolve after a retry");
    assert.equal(calls, 2);
  });

  it("classifies 429 as retryable and a bad key as not", () => {
    assert.equal(isRetryableStatus(429), true);
    assert.equal(isRetryableStatus(401), false, "retrying a bad key is pointless");
    assert.equal(isRetryableStatus(404), false);
    assert.equal(parseRetryAfterMs("2", 0), 2000);
  });
});

describe("fault: provider outage (5xx) trips the breaker", () => {
  it("fails fast once the provider is confirmed down", async () => {
    mockFetch(() => jsonResponse(503, { error: "down" }));
    const cfg = { failureThreshold: 2, cooldownMs: 60_000 };
    for (let i = 0; i < 2; i++) {
      await resilientFetch("dead-provider", "https://x.test/a", {}, { breaker: cfg });
    }
    assert.equal(breakerState("dead-provider"), "open");

    let hammered = false;
    mockFetch(() => {
      hammered = true;
      return jsonResponse(503, {});
    });
    await assert.rejects(
      () => resilientFetch("dead-provider", "https://x.test/a", {}, { breaker: cfg }),
      CircuitOpenError,
    );
    assert.equal(hammered, false, "an open circuit must not reach the network at all");
  });

  it("a 4xx keeps the circuit closed — the request is wrong, not the provider", async () => {
    mockFetch(() => jsonResponse(404, { error: "no such instrument" }));
    const cfg = { failureThreshold: 2, cooldownMs: 60_000 };
    for (let i = 0; i < 3; i++) {
      await resilientFetch("healthy-provider", "https://x.test/a", {}, { breaker: cfg });
    }
    assert.equal(breakerState("healthy-provider"), "closed");
  });
});

describe("fault: network drop mid-request", () => {
  it("is classified as retryable network, never as a market verdict", async () => {
    mockFetch(() => {
      throw new TypeError("fetch failed");
    });
    await assert.rejects(
      () => resilientFetch("net-provider", "https://x.test/a", {}, { maxRetries: 0 }),
      /fetch failed/,
    );
    const classified = classifyAgentError(new TypeError("fetch failed"));
    assert.equal(classified.code, "network");
    assert.equal(classified.retryable, true);
  });
});

describe("fault: LLM auth failure and malformed reply", () => {
  it("a bad key is permanent — retrying must not be advertised", () => {
    const auth = classifyAgentError(new Error("Incorrect API key provided: sk-xxx (HTTP 401)"));
    assert.equal(auth.code, "auth");
    assert.equal(auth.retryable, false);
    assert.equal(isRetryableFailureCode("auth"), false);
  });

  it("a malformed model reply is transient — one retry is legitimate", () => {
    const bad = classifyAgentError(new SyntaxError("Unexpected token < in JSON at position 0"));
    assert.equal(bad.code, "invalid_payload");
    assert.equal(bad.retryable, true);
  });

  it("a deliberate cancellation is never a fault", () => {
    const err = new Error("The operation was aborted");
    err.name = "AbortError";
    const classified = classifyAgentError(err);
    assert.equal(classified.code, "cancelled");
    assert.equal(classified.retryable, false);
  });
});

describe("fault: research service unreachable while direct analysis continues", () => {
  it("a service outage is transport, so live jobs are never marked failed", () => {
    const down = new ResearchServiceError("RESEARCH_SERVICE_UNAVAILABLE", "connect ECONNREFUSED", 503);
    assert.equal(isTransportFailure(down), true);
    const timeout = new ResearchServiceError("RESEARCH_SERVICE_TIMEOUT", "timed out", 504);
    assert.equal(isTransportFailure(timeout), true);
  });

  it("a genuine job verdict is NOT transport (it must still fail the job)", () => {
    const verdict = new ResearchServiceError("RESEARCH_SERVICE_ERROR", "invalid payload", 422);
    assert.equal(isTransportFailure(verdict), false);
  });
});

describe("fault: resource exhaustion (disk full / OOM)", () => {
  it("is classified as retryable resource exhaustion, not silent success", () => {
    for (const message of [
      "SQLITE_FULL: database or disk is full",
      "ENOSPC: no space left on device",
      "JavaScript heap out of memory",
    ]) {
      const classified = classifyAgentError(new Error(message));
      assert.equal(classified.code, "resource_exhausted", message);
      assert.equal(classified.retryable, true, message);
    }
  });
});

describe("fault: TS/Python threshold divergence", () => {
  // The documented incident: a second validator kept an old limit after the
  // source was raised, so identical data got two different verdicts. This test
  // fails the build if the shared minimum drifts apart again.
  it("the TS execution-evidence minimum matches the Python demo-gate minimum", () => {
    // research-service/app/validation/models.py :: minimum_demo_trades default.
    const PYTHON_MINIMUM_DEMO_TRADES = 100;
    assert.equal(
      MIN_BACKTEST_TRADES,
      PYTHON_MINIMUM_DEMO_TRADES,
      "TS MIN_BACKTEST_TRADES and Python minimum_demo_trades must move together",
    );
  });

  it("the 100-trade gate is never lowered (plan: must not change)", () => {
    assert.ok(
      MIN_BACKTEST_TRADES >= 100,
      "lowering the 100-trade minimum is explicitly forbidden by the plan",
    );
  });
});

/**
 * Coverage map for the plan's fault matrix — scenarios owned by other suites:
 *  - thread/process that ignores cancellation → research-service
 *    tests/jobs/test_process_worker.py (force-kill + health stays responsive)
 *  - polling interruption vs job failure → research/__tests__/transportState.test.ts
 *  - client disconnect / stage deadline cancellation → agent/__tests__/withDeadline.test.ts
 *  - missing SSE `final` event → agent/__tests__/phase0Contracts.test.ts
 *  - layout save failure + usage accounting → agent/__tests__/phase0Contracts.test.ts
 *    and agent/__tests__/analysisAccounting.test.ts
 *  - synthesizer failure taxonomy → agent/__tests__/synthesizerDiagnostics.test.ts
 *  - 50k-bar simulation off the event loop → research-service
 *    tests/backtest/test_process_isolation.py
 */
