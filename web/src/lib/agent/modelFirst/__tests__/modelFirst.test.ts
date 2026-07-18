import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  clearCachedModelRegistry,
  getCachedModelRegistry,
  isAllowlistedModelId,
  pickDefaultModelId,
  projectPublicModels,
  validateReasoningForModel,
  validateUserModelSelection,
} from "../modelRegistry";
import { stubProbedRegistry } from "../probeModels";
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
  it("rejects invented / arbitrary model IDs", () => {
    assert.equal(isAllowlistedModelId("gpt-5.6-sol"), true); // pattern ok until probe
    assert.equal(isAllowlistedModelId("totally-made-up-model"), false);
    assert.equal(isAllowlistedModelId("text-embedding-3-large"), false);
    assert.equal(isAllowlistedModelId("whisper-1"), false);
  });

  it("rejects unavailable selections and does not silently substitute", () => {
    clearCachedModelRegistry();
    const records = stubProbedRegistry(["gpt-4.1", "o3-mini"]);
    assert.equal(getCachedModelRegistry(), null);
    const bad = validateUserModelSelection("o4-mini", records);
    assert.equal(bad.ok, false);
    const good = validateUserModelSelection("gpt-4.1", records);
    assert.equal(good.ok, true);
    if (good.ok) assert.equal(good.record.id, "gpt-4.1");
  });

  it("maps reasoning options per model capabilities", () => {
    const records = stubProbedRegistry(["gpt-4.1", "o3-mini"]);
    const gpt = records.find((r) => r.id === "gpt-4.1")!;
    const o3 = records.find((r) => r.id === "o3-mini")!;
    assert.deepEqual(gpt.supportedReasoningValues, []);
    assert.ok(o3.supportedReasoningValues.includes("high"));
    const high = validateReasoningForModel("high", o3);
    assert.equal(high.ok, true);
    if (high.ok) assert.equal(high.effort, "high");
    const unsupported = validateReasoningForModel("high", {
      ...o3,
      supportedReasoningValues: ["low"],
    });
    assert.equal(unsupported.ok, false);
    const nonReasoning = validateReasoningForModel("high", gpt);
    assert.deepEqual(nonReasoning, {
      ok: false,
      error: "reasoning_unsupported",
    });
    assert.deepEqual(validateReasoningForModel(undefined, gpt), {
      ok: true,
      effort: null,
    });
  });

  it("picks non-premium default when eligible", () => {
    const records = stubProbedRegistry(["o3-pro", "gpt-4.1", "o3-mini"]);
    const id = pickDefaultModelId(records);
    assert.ok(id === "gpt-4.1" || id === "o3-mini");
    assert.notEqual(id, "o3-pro");
    const publics = projectPublicModels(records);
    assert.ok(publics.length <= 5);
  });
});

describe("Responses store:false contract", () => {
  it("defaults store to false for trading bodies", () => {
    const body = buildTradingResponsesBody({
      model: "o3-mini",
      inputText: "analyze",
      reasoningEffort: "high",
    });
    assert.equal(body.store, false);
    assert.deepEqual(body.reasoning, { effort: "high" });
  });

  it("cannot enable provider storage through the trading body helper", () => {
    const body = buildTradingResponsesBody({
      model: "o3-mini",
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
