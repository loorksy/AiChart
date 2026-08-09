import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  deriveRecommendationReason,
  shouldChargeAnalysis,
} from "@/lib/agent/analysisAccounting";
import {
  descriptiveEnvelope,
  envelopeForFinalDecision,
  operationalBlockerEnvelope,
} from "@/lib/agent/resultEnvelope";

describe("analysis charging policy", () => {
  it("never charges for an operational blocker", () => {
    const blocked = operationalBlockerEnvelope({
      failureStage: "market_data",
      failureCode: "provider_unavailable",
      retryable: true,
    });
    assert.equal(shouldChargeAnalysis(blocked), false);
  });

  it("charges for descriptive and validated outcomes", () => {
    assert.equal(shouldChargeAnalysis(descriptiveEnvelope()), true);
    assert.equal(
      shouldChargeAnalysis(
        envelopeForFinalDecision({ actionableRecommendation: true, validatedEvidence: true }),
      ),
      true,
    );
  });

  it("keeps legacy behaviour when the envelope is missing", () => {
    assert.equal(shouldChargeAnalysis(undefined), true);
  });
});

describe("null-recommendation reasons", () => {
  it("a blocker null names the failure code", () => {
    const env = operationalBlockerEnvelope({
      failureStage: "final_decision",
      failureCode: "rate_limit",
      retryable: true,
    });
    assert.equal(
      deriveRecommendationReason("informational", env),
      "operational_blocker:rate_limit",
    );
  });

  it("a WAIT null is a decision, not a fault", () => {
    assert.equal(deriveRecommendationReason("wait", descriptiveEnvelope()), "wait_decision");
  });

  it("an informational null is descriptive", () => {
    assert.equal(
      deriveRecommendationReason("informational", descriptiveEnvelope()),
      "descriptive_only",
    );
  });
});
