import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildInformationalConfidence,
  buildRecommendationConfidence,
  buildWaitConfidence,
} from "@/lib/agent/confidenceSemantics";

describe("confidence semantics", () => {
  it("informational responses expose no recommendation confidence badge", () => {
    const c = buildInformationalConfidence({ analysisConfidence: 0.8 });
    assert.equal(c.displayKind, "none");
    assert.equal(c.recommendationConfidence, "not_applicable");
    assert.equal(c.displayValue, "not_applicable");
  });

  it("WAIT without recommendation exposes no confidence badge", () => {
    const c = buildWaitConfidence({
      decisionConfidence: 0.9,
      dataQualityScore: 0.3,
      setupQuality: null,
      reasons: ["M15: 64/500"],
    });
    assert.equal(c.displayKind, "none");
    assert.equal(c.displayLabelKey, "agent.decision_confidence");
    assert.equal(c.displayValue, "not_applicable");
    assert.equal(c.recommendationConfidence, "not_applicable");
    assert.equal(c.executionReadiness, "not_applicable");
    assert.ok(typeof c.decisionConfidence === "number" && c.decisionConfidence >= 0.85);
  });

  it("preserves model confidence without hidden policy caps", () => {
    const c = buildRecommendationConfidence({
      base: 0.8,
      dataQualityScore: 0.2,
      setupQuality: 0.9,
      newsRisk: "unknown",
      dataSufficientForTrade: false,
    });
    assert.equal(c.displayKind, "recommendation");
    assert.equal(c.recommendationConfidence, 0.8);
  });

  it("persisted-style recommendation confidence is only for actionable setups", () => {
    const c = buildRecommendationConfidence({
      base: 0.74,
      dataQualityScore: 1,
      setupQuality: 0.85,
      newsRisk: "low",
      dataSufficientForTrade: true,
    });
    assert.equal(c.recommendationConfidence, c.displayValue);
    assert.ok(
      typeof c.recommendationConfidence === "number" &&
        c.recommendationConfidence >= 0.7,
    );
  });
});
