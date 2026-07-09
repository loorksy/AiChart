import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runFinalDecisionSynthesizer } from "@/lib/agent/agents/finalDecisionSynthesizer";
import type {
  FinalDecisionInput,
  FinalDecisionResult,
} from "@/lib/agent/agents/finalDecisionAgent";
import type { AgentMarketContext } from "@/lib/agent/marketContext/buildAgentMarketContext";
import type { AgentRunContext } from "@/lib/agent/types";
import type { RiskAgentResult } from "@/lib/agent/agents/riskAgent";

function fakeCtx(): AgentRunContext {
  return { requestId: "t", emitActivity: () => {} };
}

function market(): AgentMarketContext {
  return {
    symbol: "EURUSD",
    interval: "15m",
    currentPrice: 1.1,
    marketRegime: "range",
    dataQuality: { currentTfCount: 600, higherTfCount: 250, dailyCount: 120, sufficient: true },
    currentTfCandles: [],
    higherTfCandles: [],
    dailyCandles: [],
  } as unknown as AgentMarketContext;
}

function det(over: Partial<FinalDecisionResult> = {}): FinalDecisionResult {
  return {
    decision: "wait",
    confidence: 0.6,
    summary: "انتظار: لا منطقة دخول.",
    keyReasons: ["نسبة العائد/المخاطرة غير كافية."],
    riskWarnings: [],
    recommendation: { action: "wait" },
    publicReasoningSummary: ["لا POI قريبة."],
    riskVeto: false,
    ...over,
  };
}

function baseInput(
  deterministic: FinalDecisionResult,
  risk: RiskAgentResult | null = null,
): FinalDecisionInput & { deterministic: FinalDecisionResult; candidates: [] } {
  return {
    userMessage: "حلل",
    risk,
    news: null,
    market: market(),
    structure: { trend: "range", swings: [], support: [], resistance: [] },
    supplyDemand: { zones: [], nearestDemand: null, nearestSupply: null },
    mtf: null,
    deterministic,
    candidates: [],
  };
}

const modelJson = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    decision: "wait",
    confidence: 0.6,
    summary: "انتظار على اليورو دولار: السعر وسط النطاق ولا ميزة للدخول الآن.",
    keyReasons: ["السعر وسط النطاق."],
    riskWarnings: [],
    publicReasoningSummary: ["السعر بعيد عن أي POI قوية."],
    drawingAdvice: { shouldDraw: false, reason: "لا مستويات قوية." },
    ...over,
  });

describe("finalDecisionSynthesizer", () => {
  it("LLM success sets usedLLM=true and uses model wording", async () => {
    const out = await runFinalDecisionSynthesizer(fakeCtx(), baseInput(det()), {
      configured: true,
      callModel: async () => modelJson(),
    });
    assert.equal(out.usedLLM, true);
    assert.ok(out.result.summary.includes("وسط النطاق"));
    assert.equal(out.drawingAdvice?.shouldDraw, false);
  });

  it("risk veto cannot be overridden: model buy is forced to WAIT with real reasons", async () => {
    const vetoDet = det({
      riskVeto: true,
      keyReasons: ["السبريد مرتفع جداً."],
    });
    const out = await runFinalDecisionSynthesizer(fakeCtx(), baseInput(vetoDet), {
      configured: true,
      callModel: async () =>
        modelJson({ decision: "buy", confidence: 0.95, keyReasons: [] }),
    });
    assert.equal(out.result.decision, "wait");
    assert.equal(out.result.recommendation.action, "wait");
    assert.ok(out.result.keyReasons.includes("السبريد مرتفع جداً."));
  });

  it("model cannot invent a trade the deterministic engine did not propose", async () => {
    const out = await runFinalDecisionSynthesizer(fakeCtx(), baseInput(det()), {
      configured: true,
      callModel: async () => modelJson({ decision: "sell", confidence: 0.9 }),
    });
    // deterministic proposed wait → sell is rejected → wait, no invented levels.
    assert.equal(out.result.decision, "wait");
    assert.equal(out.result.recommendation.action, "wait");
  });

  it("model may confirm the deterministic trade with its numbers preserved", async () => {
    const buyDet = det({
      decision: "buy",
      recommendation: { action: "buy", entry: 1.1, stop_loss: 1.09, targets: [1.13] },
    });
    const out = await runFinalDecisionSynthesizer(fakeCtx(), baseInput(buyDet), {
      configured: true,
      callModel: async () => modelJson({ decision: "buy", confidence: 0.8 }),
    });
    assert.equal(out.result.decision, "buy");
    assert.equal(out.result.recommendation.entry, 1.1);
    assert.equal(out.result.recommendation.stop_loss, 1.09);
  });

  it("high news risk caps confidence", async () => {
    const buyDet = det({
      decision: "buy",
      recommendation: { action: "buy", entry: 1.1, stop_loss: 1.09, targets: [1.13] },
    });
    const input = {
      ...baseInput(buyDet),
      news: {
        newsRisk: "high" as const,
        biasImpact: "unknown" as const,
        affectedCurrencies: [],
        upcomingEvents: [],
        tradeAllowed: false,
        reason: "High-impact event soon.",
      },
    };
    const out = await runFinalDecisionSynthesizer(fakeCtx(), input, {
      configured: true,
      callModel: async () => modelJson({ decision: "buy", confidence: 0.95 }),
    });
    assert.ok(out.result.confidence <= 0.55);
  });

  it("schema failure falls back to deterministic (usedDeterministicFallback)", async () => {
    const d = det();
    const out = await runFinalDecisionSynthesizer(fakeCtx(), baseInput(d), {
      configured: true,
      callModel: async () => "totally invalid",
    });
    assert.equal(out.usedLLM, false);
    assert.equal(out.result, d);
  });

  it("LLM not configured falls back to deterministic", async () => {
    const d = det();
    const out = await runFinalDecisionSynthesizer(fakeCtx(), baseInput(d), {
      configured: false,
    });
    assert.equal(out.usedLLM, false);
    assert.equal(out.result, d);
  });

  it("chain-of-thought phrasing is stripped from model output", async () => {
    const out = await runFinalDecisionSynthesizer(fakeCtx(), baseInput(det()), {
      configured: true,
      callModel: async () =>
        modelJson({
          summary:
            "chain of thought: انتظار على اليورو دولار لأن السعر وسط النطاق.",
        }),
    });
    assert.ok(!out.result.summary.toLowerCase().includes("chain of thought"));
  });
});
