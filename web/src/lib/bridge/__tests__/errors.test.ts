import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ApiError } from "@/lib/api";
import {
  BridgeErrorCode,
  bridgeError,
  bridgeSuccess,
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
      BridgeErrorCode.EXECUTION_UNAUTHORIZED,
      "Blocked",
      "مرفوض",
    );
    assert.equal(risk.error.retriable, false);
  });

  it("toBridgeFailure maps ApiError to envelope", () => {
    const failure = toBridgeFailure(new ApiError(403, "Denied"));
    assert.equal(failure.ok, false);
    assert.equal(failure.error.code, BridgeErrorCode.EXECUTION_UNAUTHORIZED);
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
