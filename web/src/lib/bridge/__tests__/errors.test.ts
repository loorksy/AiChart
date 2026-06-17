import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ApiError } from "@/lib/api";
import {
  BridgeErrorCode,
  bridgeError,
  bridgeSuccess,
  lowConfidenceFailure,
  toBridgeFailure,
  toBridgeResponse,
} from "@/lib/bridge/errors";

describe("bridge/errors", () => {
  it("bridgeError sets retriable defaults per code", () => {
    const stale = bridgeError(
      BridgeErrorCode.STALE_QUOTE,
      "Quote stale",
      "السعر قديم",
    );
    assert.equal(stale.ok, false);
    assert.equal(stale.error.code, BridgeErrorCode.STALE_QUOTE);
    assert.equal(stale.error.retriable, true);

    const risk = bridgeError(
      BridgeErrorCode.RISK_LIMIT_EXCEEDED,
      "Blocked",
      "مرفوض",
    );
    assert.equal(risk.error.retriable, false);
  });

  it("LOW_CONFIDENCE mapping via lowConfidenceFailure", () => {
    const failure = lowConfidenceFailure(50, 80);
    assert.equal(failure.ok, false);
    assert.equal(failure.error.code, BridgeErrorCode.LOW_CONFIDENCE);
    assert.equal(failure.error.retriable, false);
    assert.match(failure.error.message, /80/);
    assert.match(failure.error.message_ar ?? "", /80%/);
    assert.deepEqual(failure.error.details, {
      confidence: 50,
      minConfidence: 80,
    });
  });

  it("toBridgeFailure maps ApiError to envelope", () => {
    const failure = toBridgeFailure(new ApiError(403, "Denied"));
    assert.equal(failure.ok, false);
    assert.equal(failure.error.code, BridgeErrorCode.RISK_LIMIT_EXCEEDED);
    assert.equal(failure.error.message, "Denied");
  });

  it("toBridgeResponse serializes success envelope", async () => {
    const res = toBridgeResponse(bridgeSuccess({ mode: "auto" }, { requestId: "r1" }));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.deepEqual(body.data, { mode: "auto" });
    assert.equal(body.meta.requestId, "r1");
  });

  it("toBridgeResponse serializes LOW_CONFIDENCE with 403", async () => {
    const res = toBridgeResponse(lowConfidenceFailure(79, 80));
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.ok, false);
    assert.equal(body.error.code, BridgeErrorCode.LOW_CONFIDENCE);
  });

  it("toBridgeResponse maps RATE_LIMITED to 429", async () => {
    const res = toBridgeResponse(
      bridgeError(
        BridgeErrorCode.RATE_LIMITED,
        "Too many writes",
        "كثير من الطلبات",
        undefined,
        { retriable: true, retryAfterMs: 1500 },
      ),
    );
    assert.equal(res.status, 429);
    const body = await res.json();
    assert.equal(body.error.retryAfterMs, 1500);
  });
});
