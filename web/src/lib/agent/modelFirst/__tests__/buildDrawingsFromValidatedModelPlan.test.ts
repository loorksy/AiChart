import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildDrawingsFromValidatedModelPlan } from "../buildDrawingsFromValidatedModelPlan";
import { validateModelTradePlan } from "../validatedTradePlan";
import { toFinalResult } from "../runModelFirstDecision";
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
    keyReasons: ["structure"],
    warnings: [],
    dataTimestamp: new Date().toISOString(),
    ...over,
  };
}

describe("buildDrawingsFromValidatedModelPlan", () => {
  it("draws valid BUY levels", () => {
    const p = plan({ decision: "buy" });
    const validated = validateModelTradePlan({
      plan: p,
      currentPrice: 1.1005,
      quoteAgeMs: 100,
    });
    const drawings = buildDrawingsFromValidatedModelPlan({
      decision: toFinalResult(p, validated),
      validated,
      lastCandleTime: 1,
    });
    assert.equal(drawings.shouldDraw, true);
    assert.equal(drawings.selectedZones.length, 1);
    assert.equal(drawings.selectedZones[0]!.type, "demand");
  });

  it("draws valid SELL levels", () => {
    const p = plan({
      decision: "sell",
      stopLoss: 1.102,
      invalidation: 1.1025,
      targets: [
        { price: 1.099, reason: "tp1" },
        { price: 1.098, reason: "tp2" },
      ],
    });
    const validated = validateModelTradePlan({
      plan: p,
      currentPrice: 1.1005,
      quoteAgeMs: 100,
    });
    const drawings = buildDrawingsFromValidatedModelPlan({
      decision: toFinalResult(p, validated),
      validated,
      lastCandleTime: 1,
    });
    assert.equal(drawings.shouldDraw, true);
    assert.equal(drawings.selectedZones[0]!.type, "supply");
  });

  it("draws conditional BUY with confirmation annotation", () => {
    const p = plan({
      decision: "buy",
      activation: "conditional",
      requiredConfirmation: "Touch demand and hold",
    });
    const validated = validateModelTradePlan({
      plan: p,
      currentPrice: 1.105,
      quoteAgeMs: 100,
    });
    const drawings = buildDrawingsFromValidatedModelPlan({
      decision: toFinalResult(p, validated),
      validated,
      lastCandleTime: 1,
    });
    if (validated.executionReady) {
      assert.equal(drawings.shouldDraw, true);
      assert.ok(
        drawings.selectedAnnotations.some((a) =>
          a.label.includes("Touch demand"),
        ),
      );
    } else {
      assert.equal(drawings.shouldDraw, false);
    }
  });

  it("draws conditional SELL when technically ready", () => {
    const p = plan({
      decision: "sell",
      activation: "conditional",
      stopLoss: 1.102,
      invalidation: 1.1025,
      targets: [
        { price: 1.099, reason: "tp1" },
        { price: 1.098, reason: "tp2" },
      ],
      requiredConfirmation: "Reject supply",
    });
    const validated = validateModelTradePlan({
      plan: p,
      currentPrice: 1.1005,
      quoteAgeMs: 100,
    });
    const drawings = buildDrawingsFromValidatedModelPlan({
      decision: toFinalResult(p, validated),
      validated,
      lastCandleTime: 1,
    });
    assert.equal(validated.decision, "sell");
    if (validated.executionReady) {
      assert.equal(drawings.shouldDraw, true);
    }
  });

  it("does not draw invalid BUY levels as executable", () => {
    const p = plan({
      decision: "buy",
      stopLoss: 1.2,
      targets: [{ price: 1.0, reason: "wrong" }],
    });
    const validated = validateModelTradePlan({
      plan: p,
      currentPrice: 1.1005,
      quoteAgeMs: 100,
    });
    const result = toFinalResult(p, validated);
    const drawings = buildDrawingsFromValidatedModelPlan({
      decision: result,
      validated,
      lastCandleTime: 1,
    });
    assert.equal(result.decision, "buy");
    assert.equal(drawings.shouldDraw, false);
    assert.equal(drawings.selectedZones.length, 0);
    assert.ok(
      drawings.selectedAnnotations.some((a) =>
        a.label.includes("Levels require refresh"),
      ),
    );
  });

  it("does not draw invalid SELL levels as executable", () => {
    const p = plan({
      decision: "sell",
      stopLoss: 1.0,
      targets: [{ price: 1.2, reason: "wrong" }],
    });
    const validated = validateModelTradePlan({
      plan: p,
      currentPrice: 1.1005,
      quoteAgeMs: 100,
    });
    const drawings = buildDrawingsFromValidatedModelPlan({
      decision: toFinalResult(p, validated),
      validated,
      lastCandleTime: 1,
    });
    assert.equal(drawings.shouldDraw, false);
    assert.equal(drawings.selectedZones.length, 0);
  });

  it("failed repair keeps direction and refuses executable drawings", () => {
    const p = plan({
      decision: "buy",
      stopLoss: 1.2,
      targets: [{ price: 1.0, reason: "wrong" }],
    });
    const validated = validateModelTradePlan({
      plan: p,
      currentPrice: 1.1005,
      quoteAgeMs: 100,
    });
    assert.equal(validated.executionReady, false);
    const drawings = buildDrawingsFromValidatedModelPlan({
      decision: toFinalResult(p, validated),
      validated,
      lastCandleTime: 1,
    });
    assert.equal(drawings.shouldDraw, false);
    assert.equal(toFinalResult(p, validated).decision, "buy");
  });

  it("execution unavailable does not draw trade geometry", () => {
    const p = plan({ decision: "buy" });
    const validated = {
      ...validateModelTradePlan({
        plan: p,
        currentPrice: 1.1005,
        quoteAgeMs: 100,
      }),
      executionReady: false,
      technicalErrors: ["execution_unavailable"],
    };
    const drawings = buildDrawingsFromValidatedModelPlan({
      decision: toFinalResult(p, validated),
      validated,
      lastCandleTime: 1,
    });
    assert.equal(drawings.shouldDraw, false);
    assert.equal(drawings.drawingIntent, "none");
  });
});
