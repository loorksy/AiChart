import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runDrawingAgent } from "@/lib/agent/agents/drawingAgent";
import type { DrawingPlan } from "@/lib/agent/drawings/buildDrawingPlan";
import type { AgentMarketContext } from "@/lib/agent/marketContext/buildAgentMarketContext";
import type { AgentRunContext } from "@/lib/agent/types";
import type { FinalDecisionResult } from "@/lib/agent/agents/finalDecisionAgent";

function fakeCtx(): AgentRunContext {
  return { requestId: "t", emitActivity: () => {} };
}

const market = {
  interval: "15m",
  currentPrice: 100,
  currentTfCandles: Array.from({ length: 50 }, (_, i) => ({
    time: i * 60_000,
    open: 100,
    high: 101,
    low: 99,
    close: 100,
  })),
} as unknown as AgentMarketContext;

const finalDecision: FinalDecisionResult = {
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
};

describe("drawingAgent (plan-only)", () => {
  it("returns NO drawings when plan.shouldDraw is false", async () => {
    const plan: DrawingPlan = {
      shouldDraw: false,
      reason: "قرار انتظار دون مستويات قوية.",
      drawingIntent: "none",
      selectedLevels: [],
      selectedZones: [],
      selectedAnnotations: [],
      selectedGeometry: [],
    };
    const out = await runDrawingAgent(fakeCtx(), {
      analysisId: "a1",
      market,
      finalDecision,
      plan,
    });
    assert.equal(out.length, 0);
  });

  it("draws only the plan's selected level for a WAIT", async () => {
    const plan: DrawingPlan = {
      shouldDraw: true,
      reason: "wait_zones",
      drawingIntent: "wait_zones",
      selectedLevels: [
        { type: "support", price: 99.5, time: 0, strength: 80, reason: "قوي" },
      ],
      selectedZones: [],
      selectedAnnotations: [],
      selectedGeometry: [],
    };
    const out = await runDrawingAgent(fakeCtx(), {
      analysisId: "a1",
      market,
      finalDecision,
      plan,
    });
    assert.equal(out.length, 1);
    assert.equal(out[0]!.semanticRole, "support");
    // Agent-owned + stamped.
    assert.equal((out[0]!.meta as { owner?: string }).owner, "agent");
  });

  it("trade_setup does not emit دخول/وقف/هدف price_lines — the system RR box owns those", async () => {
    const buyDecision: FinalDecisionResult = {
      ...finalDecision,
      decision: "buy",
      recommendation: {
        action: "buy",
        entry: 100,
        stop_loss: 99,
        take_profit: 101.5,
        targets: [101.5, 102.5],
      },
    };
    const plan: DrawingPlan = {
      shouldDraw: true,
      reason: "خطة صفقة صالحة",
      drawingIntent: "trade_setup",
      selectedLevels: [],
      selectedZones: [
        {
          type: "demand",
          low: 99,
          high: 99.6,
          time: 0,
          strength: 82,
          reason: "POI",
        },
      ],
      selectedAnnotations: [
        {
          type: "bos",
          price: 100.8,
          time: 0,
          label: "هابط BOS",
          strength: 80,
          direction: "bearish",
        },
      ],
      selectedGeometry: [],
      forecastPath: [
        { time: 1, price: 100 },
        { time: 2, price: 101.5 },
      ],
    };
    const out = await runDrawingAgent(fakeCtx(), {
      analysisId: "a1",
      market,
      finalDecision: buyDecision,
      plan,
    });
    const labels = out.map((d) => d.label ?? "");
    const roles = out.map((d) => d.semanticRole);
    const tradeLine = /^(دخول|وقف(?:\s*خسارة)?|هدف(?:\s*\d+)?|entry|stop(?:\s*loss)?|take[_\s-]?profit|target(?:\s*\d+)?)$/i;
    assert.equal(
      labels.filter((l) => tradeLine.test(l.trim())).length,
      0,
      "agent must not duplicate the system entry/stop/target labels",
    );
    assert.equal(roles.includes("entry"), false);
    assert.equal(roles.includes("stop_loss"), false);
    assert.equal(roles.includes("take_profit"), false);
    assert.ok(
      out.some((d) => d.semanticRole === "demand_zone"),
      "trade_setup still draws the plan POI zone",
    );
    assert.ok(
      out.some((d) => (d.meta as { annotation?: string } | undefined)?.annotation === "bos"),
      "BOS annotations stay as agent drawings",
    );
    assert.ok(
      out.some((d) => d.type === "forecast_path"),
      "forecast path stays as an agent drawing",
    );
  });
});
