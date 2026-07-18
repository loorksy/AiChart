import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AICART_APPROVED_MODEL_IDS,
  clearCachedModelRegistry,
  getCachedModelRegistry,
  isAllowlistedModelId,
  pickDefaultModelId,
  projectPublicModels,
  validateReasoningForModel,
  validateUserModelSelection,
} from "../modelRegistry";
import { missingApprovedModelIds, stubProbedRegistry } from "../probeModels";
import { buildTradingResponsesBody } from "../openaiResponses";
import { assertNoCandidateAuthority } from "../buildNeutralEvidence";
import { validateTradePlanTechnically } from "../validatedTradePlan";
import type { ModelTradePlan } from "../modelTradePlan";
import {
  platformChartBoundScope,
  resolveContextTimeframes,
} from "../contextTimeframes";
import { getTempCaptureRetentionMs } from "../neutralVision";

describe("model registry", () => {
  it("accepts only the exact approved product model IDs", () => {
    assert.deepEqual(AICART_APPROVED_MODEL_IDS, [
      "gpt-5.6-sol",
      "gpt-5.6-terra",
      "gpt-5.6-luna",
      "gpt-5.5",
      "gpt-5.5-pro",
    ]);
    for (const id of AICART_APPROVED_MODEL_IDS) {
      assert.equal(isAllowlistedModelId(id), true);
    }
    assert.equal(isAllowlistedModelId("gpt-4.1"), false);
    assert.equal(isAllowlistedModelId("o4-mini"), false);
    assert.equal(isAllowlistedModelId("totally-made-up-model"), false);
    assert.equal(isAllowlistedModelId("text-embedding-3-large"), false);
    assert.equal(isAllowlistedModelId("whisper-1"), false);
  });

  it("rejects unavailable selections and does not silently substitute", () => {
    clearCachedModelRegistry();
    const records = stubProbedRegistry(["gpt-5.6-sol", "gpt-5.6-terra"]);
    assert.equal(getCachedModelRegistry(), null);
    const bad = validateUserModelSelection("gpt-5.6-luna", records);
    assert.equal(bad.ok, false);
    const good = validateUserModelSelection("gpt-5.6-sol", records);
    assert.equal(good.ok, true);
    if (good.ok) assert.equal(good.record.id, "gpt-5.6-sol");
  });

  it("maps reasoning options per model capabilities", () => {
    const [sol] = stubProbedRegistry(["gpt-5.6-sol"]);
    assert.ok(sol.supportedReasoningValues.includes("high"));
    const high = validateReasoningForModel("high", sol);
    assert.equal(high.ok, true);
    if (high.ok) assert.equal(high.effort, "high");
    const unsupported = validateReasoningForModel("high", {
      ...sol,
      supportedReasoningValues: ["xhigh"],
    });
    assert.equal(unsupported.ok, false);
    const nonReasoningRecord = {
      ...sol,
      reasoning: false,
      supportedReasoningValues: [],
    };
    const nonReasoning = validateReasoningForModel("high", nonReasoningRecord);
    assert.deepEqual(nonReasoning, {
      ok: false,
      error: "reasoning_unsupported",
    });
    assert.deepEqual(validateReasoningForModel(undefined, nonReasoningRecord), {
      ok: true,
      effort: null,
    });
  });

  it("uses approved product order and a non-premium default", () => {
    const records = stubProbedRegistry([
      "gpt-5.5-pro",
      "gpt-5.6-terra",
      "gpt-5.6-sol",
    ]);
    const id = pickDefaultModelId(records);
    assert.equal(id, "gpt-5.6-sol");
    const staleOldRecord = {
      ...records[0]!,
      id: "gpt-4.1",
      displayName: "GPT-4.1",
    };
    const publics = projectPublicModels([staleOldRecord, ...records]);
    assert.deepEqual(
      publics.map((record) => record.id),
      ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.5-pro"],
    );
  });

  it("reports approved IDs absent from the provider model catalog", () => {
    assert.deepEqual(
      missingApprovedModelIds(["openai/gpt-5.6-sol", "gpt-5.5"]),
      ["gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.5-pro"],
    );
  });
});

describe("Responses store:false contract", () => {
  it("defaults store to false for trading bodies", () => {
    const body = buildTradingResponsesBody({
      model: "gpt-5.6-sol",
      inputText: "analyze",
      reasoningEffort: "high",
    });
    assert.equal(body.store, false);
    assert.deepEqual(body.reasoning, { effort: "high" });
  });

  it("cannot enable provider storage through the trading body helper", () => {
    const body = buildTradingResponsesBody({
      model: "gpt-5.6-sol",
      inputText: "analyze",
    });
    assert.equal(body.store, false);
  });
});

describe("authority: no candidate fields in model evidence", () => {
  it("flags candidate authority keys", () => {
    const leaks = assertNoCandidateAuthority({
      selectedCandidate: { id: "c1" },
      tradeCandidates: [{ id: "c1" }],
      playbook: { checklist: [] },
    });
    assert.ok(leaks.includes("selectedCandidate"));
    assert.ok(leaks.includes("tradeCandidates"));
    assert.ok(leaks.includes("playbook"));
  });

  it("reports nested candidate authority paths", () => {
    const leaks = assertNoCandidateAuthority({
      safe: { nested: [{ candidate_score: 0.9 }] },
    });
    assert.deepEqual(leaks, ["safe.nested[0].candidate_score"]);
  });

  it("allows null markers and clean evidence", () => {
    const clean = assertNoCandidateAuthority({
      snapshot: { symbol: "EURUSD" },
      candleEnvelopes: [],
      selectedCandidate: null,
    });
    assert.deepEqual(clean, []);
  });
});

describe("ValidatedTradePlan never flips direction", () => {
  const basePlan = (decision: "buy" | "sell"): ModelTradePlan => ({
    decision,
    activation: "immediate",
    confidence: 0.7,
    summary: "Invalid geometry on purpose for technical checks.",
    marketThesis: "Directional thesis preserved under technical failure.",
    currentPriceContext: "Price near zone.",
    timeframeAlignment: [],
    keyReasons: ["structure"],
    warnings: [],
    entryZone: { low: 1.1, high: 1.11, preferred: 1.105 },
    stopLoss: decision === "buy" ? 1.2 : 1.0,
    targets: [
      {
        price: decision === "buy" ? 1.0 : 1.2,
        rationale: "wrong side",
      },
    ],
    invalidation: null,
    requiredConfirmation: null,
    pathToEntry: null,
    alternativeScenario: "Wait for cleaner structure.",
    dataTimestamp: new Date().toISOString(),
    visionTimeframesUsed: ["5m"],
    numericTimeframesUsed: ["5m", "15m"],
  });

  it("keeps buy decision when levels are invalid", () => {
    const validated = validateTradePlanTechnically({
      plan: basePlan("buy"),
      currentPrice: 1.105,
    });
    assert.equal(validated.decision, "buy");
    assert.equal(validated.directionPreserved, true);
    assert.equal(validated.executionReady, false);
    assert.ok(validated.technicalErrors.length > 0);
  });

  it("keeps sell decision when levels are invalid", () => {
    const validated = validateTradePlanTechnically({
      plan: basePlan("sell"),
      currentPrice: 1.105,
    });
    assert.equal(validated.decision, "sell");
    assert.equal(validated.executionReady, false);
  });
});

describe("platform timeframe binding", () => {
  it("binds primary TF to user chart and contexts as evidence only", () => {
    const scope = platformChartBoundScope({ symbol: "eurusd", timeframe: "5m" });
    assert.equal(scope.mode, "chart_bound");
    assert.equal(scope.selectionSource, "user_selected_chart");
    assert.equal(scope.timeframeConstraint, "5m");
    assert.equal(scope.symbolConstraint, "EURUSD");
    const { context } = resolveContextTimeframes("5m");
    assert.ok(context.includes("15m"));
    assert.ok(!context.includes("5m"));
  });
});

describe("vision capture retention", () => {
  it("expires temporary captures within 10 minutes", () => {
    assert.equal(getTempCaptureRetentionMs(), 10 * 60 * 1000);
  });
});
