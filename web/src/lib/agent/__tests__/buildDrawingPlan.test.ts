import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildDrawingPlan,
  hasSufficientDataForDrawings,
  type DrawingPlanInput,
} from "@/lib/agent/drawings/buildDrawingPlan";
import type { AgentMarketContext } from "@/lib/agent/marketContext/buildAgentMarketContext";
import type { AgentCandle } from "@/lib/agent/marketContext/detectors";
import type { FinalDecisionResult } from "@/lib/agent/agents/finalDecisionAgent";
import { makeLiquidity, makeStructure } from "./helpers";

/** N flat candles around a base price (enough history to pass the data gate). */
function flatCandles(n: number, base = 100, t0 = 0, step = 60_000): AgentCandle[] {
  return Array.from({ length: n }, (_, i) => ({
    time: t0 + i * step,
    open: base,
    high: base + 0.2,
    low: base - 0.2,
    close: base,
  }));
}

/** Candles that repeatedly touch `level` and bounce ~3 (strong reaction). */
function bouncingCandles(n: number, level = 100): AgentCandle[] {
  const out: AgentCandle[] = [];
  for (let i = 0; i < n; i++) {
    const phase = i % 10;
    if (phase === 0) {
      // touch the level
      out.push({ time: i * 60_000, open: level + 0.1, high: level + 0.3, low: level - 0.1, close: level });
    } else {
      // rise away from the level (reaction)
      const p = level + Math.min(phase, 3);
      out.push({ time: i * 60_000, open: p, high: p + 0.3, low: p - 0.2, close: p });
    }
  }
  return out;
}

function makeMarket(over: Partial<AgentMarketContext> = {}): AgentMarketContext {
  const current = flatCandles(600);
  return {
    symbol: "EURUSD",
    interval: "15m",
    higherInterval: "1h",
    currentPrice: 100,
    spread: 0.1,
    atr: 1,
    marketRegime: "range",
    dataQuality: {
      currentTfCount: 600,
      higherTfCount: 250,
      dailyCount: 120,
      sufficient: true,
      policyVersion: "1.1.0",
      coverage: {
        policyVersion: "1.1.0",
        analysisKind: "intraday",
        gate: "trade",
        status: "sufficient",
        sufficientForAnalysis: true,
        sufficientForTrade: true,
        sufficientForDrawing: true,
        timeframes: [],
        summaryAr: "كافٍ",
        summaryEn: "sufficient",
      },
    },
    freshness: { lastCandleTime: 0, ageMs: 0, isFresh: true },
    marketOpen: true,
    currentTfCandles: current,
    higherTfCandles: flatCandles(250),
    dailyCandles: flatCandles(120),
    visibleCandles: current,
    majorLevels: { support: [], resistance: [] },
    liquidity: { equalHighs: [], equalLows: [], nearestBuySide: null, nearestSellSide: null },
    zones: [],
    ...over,
  } as AgentMarketContext;
}

const waitDecision: FinalDecisionResult = {
  decision: "wait",
  confidence: 0.6,
  confidenceSemantics: {
    analysisConfidence: 0.6,
    decisionConfidence: 0.6,
    dataQuality: 1,
    setupQuality: "not_applicable",
    recommendationConfidence: "not_applicable",
    executionReadiness: "not_applicable",
    displayKind: "decision",
    displayLabelKey: "agent.decision_confidence",
    displayValue: 0.6,
    factors: [],
  },
  summary: "",
  keyReasons: [],
  riskWarnings: [],
  recommendation: { action: "wait" },
  publicReasoningSummary: [],
  riskVeto: false,
};

function baseInput(over: Partial<DrawingPlanInput> = {}): DrawingPlanInput {
  return {
    decision: waitDecision,
    market: makeMarket(),
    structure: makeStructure(),
    supplyDemand: { zones: [], nearestDemand: null, nearestSupply: null },
    liquidity: makeLiquidity(),
    mtf: null,
    ...over,
  };
}

describe("buildDrawingPlan", () => {
  it("does not draw when candle history is insufficient", () => {
    const market = makeMarket({
      currentTfCandles: flatCandles(100),
      higherTfCandles: flatCandles(10),
      dailyCandles: flatCandles(10),
    });
    assert.equal(hasSufficientDataForDrawings(market), false);
    const plan = buildDrawingPlan(baseInput({ market }));
    assert.equal(plan.shouldDraw, false);
    assert.equal(plan.drawingIntent, "none");
    assert.ok(plan.reason.includes("غير كافية"));
  });

  it("WAIT with no strong levels/zones draws nothing", () => {
    const plan = buildDrawingPlan(baseInput());
    assert.equal(plan.shouldDraw, false);
    assert.equal(plan.selectedLevels.length, 0);
    assert.equal(plan.selectedZones.length, 0);
  });

  it("WAIT does not draw a weak fractal level", () => {
    // A lone level far from price with zero confluence must score < 75.
    const plan = buildDrawingPlan(
      baseInput({
        structure: makeStructure({ support: [{ price: 50, time: 0 }] }),
      }),
    );
    assert.equal(plan.shouldDraw, false);
  });

  it("WAIT draws only a high-strength validated level", () => {
    const current = bouncingCandles(600, 100);
    const market = makeMarket({
      currentTfCandles: current,
      visibleCandles: current,
      atr: 1,
      // HTF confluence: a daily/major level at 100.
      majorLevels: { support: [{ price: 100, time: 0 }], resistance: [] },
    });
    const plan = buildDrawingPlan(
      baseInput({
        market,
        structure: makeStructure({ support: [{ price: 100, time: 0 }] }),
      }),
    );
    assert.equal(plan.shouldDraw, true);
    assert.equal(plan.drawingIntent, "wait_zones");
    assert.ok(plan.selectedLevels.length >= 1);
    assert.ok(plan.selectedLevels.every((l) => l.strength >= 75));
  });

  it("valid buy setup draws the POI zone + forecast path", () => {
    const demand = { type: "demand" as const, low: 99, high: 100, time: 0 };
    const plan = buildDrawingPlan(
      baseInput({
        decision: {
          ...waitDecision,
          decision: "buy",
          recommendation: {
            action: "buy",
            entry: 100,
            stop_loss: 99,
            targets: [103],
          },
        },
        supplyDemand: { zones: [demand], nearestDemand: demand, nearestSupply: null },
        structure: makeStructure({ trend: "uptrend" }),
      }),
    );
    assert.equal(plan.shouldDraw, true);
    assert.equal(plan.drawingIntent, "trade_setup");
    assert.equal(plan.selectedZones.length, 1);
    assert.equal(plan.selectedZones[0]!.type, "demand");
    assert.equal(plan.forecastPath?.length, 3);
  });

  it("buy decision with no POI does not draw", () => {
    const plan = buildDrawingPlan(
      baseInput({
        decision: {
          ...waitDecision,
          decision: "buy",
          recommendation: { action: "buy", entry: 100, stop_loss: 99, targets: [103] },
        },
        supplyDemand: { zones: [], nearestDemand: null, nearestSupply: null },
      }),
    );
    assert.equal(plan.shouldDraw, false);
    assert.equal(plan.drawingIntent, "none");
  });
});
