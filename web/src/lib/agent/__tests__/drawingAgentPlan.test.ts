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
  summary: "",
  keyReasons: [],
  riskWarnings: [],
  recommendation: { action: "wait" },
  publicReasoningSummary: [],
  riskVeto: false,
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
});
