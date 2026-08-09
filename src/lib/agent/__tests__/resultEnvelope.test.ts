import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  degradedStagesFrom,
  descriptiveEnvelope,
  envelopeForFinalDecision,
  executionValidatedEnvelope,
  operationalBlockerEnvelope,
} from "@/lib/agent/resultEnvelope";
import { buildAgentFallbackResult, buildInformationalResult } from "@/lib/agent/fallback";

describe("operational blocker envelope", () => {
  it("always states explicitly that no recommendation was issued", () => {
    const env = operationalBlockerEnvelope({
      failureStage: "market_data",
      failureCode: "timeout",
      retryable: true,
      traceId: "req-1",
    });
    assert.equal(env.outcome_class, "operational_blocker");
    assert.equal(env.recommendation_issued, false);
    assert.equal(env.recommendation_authority, "none");
    assert.equal(env.operational_status, "blocked");
    assert.equal(env.retryable, true);
    assert.equal(env.failure_stage, "market_data");
    assert.equal(env.failure_code, "timeout");
    assert.equal(env.trace_id, "req-1");
  });

  it("marks a cancelled run distinctly from a blocked one", () => {
    const env = operationalBlockerEnvelope({
      failureStage: "transport",
      failureCode: "cancelled",
      retryable: false,
      cancelled: true,
    });
    assert.equal(env.operational_status, "cancelled");
  });
});

describe("descriptive envelope", () => {
  it("carries no execution authority even with a recommendation", () => {
    const env = descriptiveEnvelope({ recommendationIssued: true });
    assert.equal(env.outcome_class, "descriptive_only");
    assert.equal(env.recommendation_authority, "descriptive");
    assert.equal(env.execution_mode, "descriptive");
  });

  it("reports degradation without hiding the answer", () => {
    const env = descriptiveEnvelope({ degradedStages: ["news", "structure"] });
    assert.equal(env.operational_status, "degraded");
    assert.deepEqual(env.degraded_stages, ["news", "structure"]);
  });
});

describe("final-decision envelope policy", () => {
  it("grants execution_validated ONLY with validated evidence", () => {
    const validated = envelopeForFinalDecision({
      actionableRecommendation: true,
      validatedEvidence: true,
    });
    assert.equal(validated.outcome_class, "execution_validated");
    assert.equal(validated.recommendation_authority, "validated");

    const modelOnly = envelopeForFinalDecision({
      actionableRecommendation: true,
      validatedEvidence: false,
    });
    assert.equal(
      modelOnly.outcome_class,
      "descriptive_only",
      "a model BUY/SELL without validated history must stay descriptive",
    );
    assert.equal(modelOnly.evidence_status, "insufficient");
    assert.equal(modelOnly.recommendation_issued, true);
  });

  it("a WAIT is descriptive with no recommendation issued", () => {
    const env = envelopeForFinalDecision({
      actionableRecommendation: false,
      validatedEvidence: false,
    });
    assert.equal(env.outcome_class, "descriptive_only");
    assert.equal(env.recommendation_issued, false);
    assert.equal(env.recommendation_authority, "none");
  });

  it("partial evidence is labelled partial, never validated", () => {
    const env = envelopeForFinalDecision({
      actionableRecommendation: true,
      validatedEvidence: false,
      partialEvidence: true,
    });
    assert.equal(env.evidence_status, "partial");
  });

  it("validated envelope never defaults execution mode to live", () => {
    const env = executionValidatedEnvelope({ executionMode: "shadow" });
    assert.equal(env.execution_mode, "shadow");
    const derived = envelopeForFinalDecision({
      actionableRecommendation: true,
      validatedEvidence: true,
      executionMode: "descriptive",
    });
    assert.equal(derived.execution_mode, "shadow", "descriptive is not a valid validated mode");
  });
});

describe("degraded stage ledger", () => {
  it("dedupes stages preserving order", () => {
    const stages = degradedStagesFrom([
      { stage: "news", code: "timeout", retryable: true, operatorDetail: "" },
      { stage: "structure", code: "network", retryable: true, operatorDetail: "" },
      { stage: "news", code: "rate_limit", retryable: true, operatorDetail: "" },
    ]);
    assert.deepEqual(stages, ["news", "structure"]);
  });
});

describe("fallback results carry the contract", () => {
  it("a partial-failure fallback is an operational blocker", () => {
    const result = buildAgentFallbackResult("reason", [], "ar", {
      failureStage: "risk",
      failureCode: "timeout",
      retryable: true,
      traceId: "req-9",
    });
    assert.equal(result.envelope?.outcome_class, "operational_blocker");
    assert.equal(result.envelope?.failure_stage, "risk");
    assert.equal(result.envelope?.failure_code, "timeout");
    assert.equal(result.envelope?.recommendation_issued, false);
    assert.equal(result.envelope?.trace_id, "req-9");
  });

  it("an informational answer is descriptive_only — never a blocker", () => {
    const result = buildInformationalResult("ملخص عام");
    assert.equal(result.envelope?.outcome_class, "descriptive_only");
    assert.equal(result.envelope?.operational_status, "ok");
  });
});
