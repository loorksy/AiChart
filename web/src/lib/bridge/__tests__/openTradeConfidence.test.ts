import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BridgeErrorCode } from "@/lib/bridge/errors";
import { bridgeEnvelopeForExecutionDenial } from "@/lib/execution";

describe("open_trade LOW_CONFIDENCE envelope", () => {
  it("maps execution denial to LOW_CONFIDENCE bridge envelope", () => {
    const envelope = bridgeEnvelopeForExecutionDenial({
      ok: false,
      denyCode: BridgeErrorCode.LOW_CONFIDENCE,
      denyDetails: { confidence: 50, minConfidence: 80 },
    });
    assert.ok(envelope);
    assert.equal(envelope!.ok, false);
    assert.equal(envelope!.error.code, BridgeErrorCode.LOW_CONFIDENCE);
    assert.deepEqual(envelope!.error.details, {
      confidence: 50,
      minConfidence: 80,
    });
  });

  it("returns null for non-confidence denials", () => {
    const envelope = bridgeEnvelopeForExecutionDenial({
      ok: false,
      denyCode: BridgeErrorCode.RISK_LIMIT_EXCEEDED,
      denyDetails: { confidence: 50, minConfidence: 80 },
    });
    assert.equal(envelope, null);
  });

  it("returns null when execution succeeded", () => {
    const envelope = bridgeEnvelopeForExecutionDenial({ ok: true });
    assert.equal(envelope, null);
  });
});
