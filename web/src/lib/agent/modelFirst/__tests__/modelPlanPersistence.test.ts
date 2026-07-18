import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildModelPlanPersistence,
  mapHistoricalRecommendationContext,
  parseModelPlanContext,
  serializeModelPlanPersistence,
} from "../modelPlanPersistence";
import { validateModelTradePlan } from "../validatedTradePlan";
import type { ModelTradePlan } from "../modelTradePlan";

function plan(over: Partial<ModelTradePlan> = {}): ModelTradePlan {
  return {
    decision: "buy",
    activation: "immediate",
    marketRegime: "trend",
    marketThesis: "Bullish structure with continuation on the primary timeframe.",
    primaryTimeframe: "5m",
    contextTimeframes: ["15m"],
    timeframeAnalysis: [
      { timeframe: "5m", bias: "bullish", evidence: "Higher lows" },
    ],
    entryZone: { low: 1.1, high: 1.101, preferred: 1.1005 },
    invalidation: 1.0985,
    stopLoss: 1.099,
    targets: [
      { price: 1.102, reason: "tp1" },
      { price: 1.103, reason: "tp2" },
    ],
    requiredConfirmation: null,
    pathToEntry: null,
    alternativeScenario: "Fade if zone fails.",
    confidence: 0.72,
    summary: "Buy plan from independent model analysis.",
    keyReasons: ["structure", "momentum"],
    warnings: [],
    dataTimestamp: new Date().toISOString(),
    ...over,
  };
}

describe("model plan persistence", () => {
  it("persists a full new model-plan row without Trade Candidate ID or poi.score", () => {
    const p = plan();
    const validated = validateModelTradePlan({
      plan: p,
      currentPrice: 1.1005,
      quoteAgeMs: 100,
    });
    const persistence = buildModelPlanPersistence({
      plan: p,
      validated,
      modelId: "gpt-test",
      reasoningEffort: "medium",
      snapshotId: "snap-1",
      snapshotFingerprint: "fp-1",
      quoteSource: "mt5",
      quoteTimestamp: 1_700_000_000_000,
      quoteAgeMs: 250,
      repairAttempted: false,
    });
    const json = serializeModelPlanPersistence(persistence);
    assert.doesNotMatch(json, /TradeCandidate|selectedTradeCandidateId|poi\.score/i);
    const roundTrip = parseModelPlanContext(json);
    assert.ok(roundTrip);
    assert.equal(roundTrip!.decision, "buy");
    assert.equal(roundTrip!.validationState, "accepted");
    assert.equal(roundTrip!.executableLevels?.entry, validated.entry);
    assert.equal(roundTrip!.modelId, "gpt-test");
    assert.equal(roundTrip!.safeProvenance.source, "unified_platform_agent");
  });

  it("maps old Candidate-backed / flat historical rows read-only", () => {
    const mapped = mapHistoricalRecommendationContext({
      contextJson: null,
      riskJson: JSON.stringify({
        poi: { score: 88, type: "demand", low: 1.1, high: 1.101 },
        invalidationLevel: 1.099,
      }),
      action: "buy",
      entry: 1.1005,
      stopLoss: 1.099,
      takeProfit: 1.102,
      confidence: 72,
      rationale: "Legacy candidate-backed recommendation",
    });
    assert.equal(mapped.kind, "historical_compat");
    assert.equal(mapped.modelPlan, null);
    assert.equal(mapped.display.hasPoiScoreCompat, true);
    assert.equal(mapped.display.decision, "buy");
    assert.equal(mapped.display.entry, 1.1005);
  });

  it("keeps rejected levels out of executableLevels", () => {
    const p = plan({
      stopLoss: 1.2,
      targets: [{ price: 1.0, reason: "wrong" }],
    });
    const validated = validateModelTradePlan({
      plan: p,
      currentPrice: 1.1005,
      quoteAgeMs: 100,
    });
    const persistence = buildModelPlanPersistence({
      plan: p,
      validated,
      repairAttempted: true,
      repairImproved: false,
    });
    assert.equal(persistence.validationState, "rejected");
    assert.equal(persistence.executableLevels, null);
    assert.equal(persistence.repairResult, "failed");
    assert.equal(persistence.decision, "buy");
  });
});
