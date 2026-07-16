import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runFinalDecisionSynthesizer } from "@/lib/agent/agents/finalDecisionSynthesizer";
import type { FinalDecisionInput } from "@/lib/agent/agents/finalDecisionAgent";
import type { AgentMarketContext } from "@/lib/agent/marketContext/buildAgentMarketContext";
import type { AgentRunContext } from "@/lib/agent/types";
import type { RiskAgentResult } from "@/lib/agent/agents/riskAgent";
import type { TradeCandidate } from "@/lib/agent/trading/buildTradeCandidates";
import { makeRisk, makeStructure } from "./helpers";

const ctx: AgentRunContext = { requestId: "test", emitActivity: () => {} };

function market(): AgentMarketContext {
  return {
    symbol: "EURUSD", interval: "5m", currentPrice: 1.1, marketRegime: "range",
    dataQuality: { currentTfCount: 600, higherTfCount: 250, dailyCount: 120, sufficient: true, policyVersion: "1.1.0" },
    currentTfCandles: [], higherTfCandles: [], dailyCandles: [],
  } as unknown as AgentMarketContext;
}

function candidate(id: string, action: "buy" | "sell"): TradeCandidate {
  const buy = action === "buy";
  return {
    id,
    action,
    entry: 1.1,
    entryType: "market",
    stop_loss: buy ? 1.09 : 1.11,
    targets: [buy ? 1.125 : 1.075, buy ? 1.15 : 1.05],
    rr: 2.5,
    netRr: 2.5,
    netRrTp2: 5,
    activationClass: "immediate",
    activationDistance: 0,
    activationDistanceAtr: 0,
    qualityScore: 0.8,
    triggerCondition: "immediate",
    setupType: "trend_continuation",
    poi: {
      type: buy ? "demand" : "supply",
      low: 1.09,
      high: 1.11,
      score: {
        score: 80,
        grade: "A",
        reasons: [],
        warnings: [],
        isTradable: true,
      },
    },
    evidence: ["real evidence"],
    warnings: [],
    invalidationReason: "structure invalidated",
  };
}

function evidence(...candidates: TradeCandidate[]): RiskAgentResult {
  return makeRisk({ candidatesResult: { candidates, best: candidates[0] ?? null, rejectedReasons: [], hasReversalEvidence: false }, selectedCandidate: candidates[0] ?? null });
}

function input(risk: RiskAgentResult | null): FinalDecisionInput & { candidates: [] } {
  return { userMessage: "analyze", risk, news: null, market: market(), structure: makeStructure(), supplyDemand: { zones: [], nearestDemand: null, nearestSupply: null }, mtf: null, candidates: [] };
}

function model(over: Record<string, unknown> = {}) {
  return JSON.stringify({ decision: "wait", selectedTradeCandidateId: null, confidence: 0.6, summary: "Specific EURUSD market decision from the supplied evidence.", keyReasons: ["evidence"], riskWarnings: [], publicReasoningSummary: ["public evidence"], drawingAdvice: { shouldDraw: false, reason: "none" }, ...over });
}

describe("AI final decision authority", () => {
  it("uses model wording and decision", async () => {
    const out = await runFinalDecisionSynthesizer(ctx, input(null), { configured: true, callModel: async () => model() });
    assert.equal(out.usedLLM, true);
    assert.equal(out.result?.decision, "wait");
    assert.match(out.result?.summary ?? "", /EURUSD/);
  });

  it("may choose either side from real opposing candidates", async () => {
    const buy = candidate("buy-1", "buy");
    const sell = candidate("sell-1", "sell");
    const out = await runFinalDecisionSynthesizer(ctx, input(evidence(buy, sell)), {
      configured: true,
      callModel: async () => model({ decision: "sell", selectedTradeCandidateId: "sell-1", confidence: 0.9 }),
    });
    assert.equal(out.result?.decision, "sell");
    assert.equal(out.result?.recommendation.stop_loss, sell.stop_loss);
  });

  it("lets the model select a real candidate from risk evidence", async () => {
    const buy = candidate("buy-1", "buy");
    const risk = evidence(buy);
    const out = await runFinalDecisionSynthesizer(ctx, input(risk), { configured: true, callModel: async () => model({ decision: "buy", selectedTradeCandidateId: "buy-1" }) });
    assert.equal(out.result?.decision, "buy");
  });

  it("high news remains evidence and does not force WAIT", async () => {
    const buy = candidate("buy-1", "buy");
    const base = input(evidence(buy));
    const out = await runFinalDecisionSynthesizer(ctx, { ...base, news: { newsRisk: "high", biasImpact: "unknown", affectedCurrencies: [], upcomingEvents: [], tradeAllowed: false, reason: "event" } }, {
      configured: true,
      callModel: async () => model({ decision: "buy", selectedTradeCandidateId: "buy-1", confidence: 0.95 }),
    });
    assert.equal(out.result?.decision, "buy");
  });

  it("keeps the model direction when no matching level candidate exists", async () => {
    const out = await runFinalDecisionSynthesizer(ctx, input(null), { configured: true, callModel: async () => model({ decision: "sell", selectedTradeCandidateId: "invented" }) });
    assert.equal(out.result?.decision, "sell");
    assert.equal(out.result?.recommendation.action, "sell");
    assert.equal(out.result?.recommendation.stop_loss, undefined);
    assert.match(out.result?.riskWarnings[0] ?? "", /قابلة للتنفيذ/);
  });

  it("model/schema failure returns no market decision", async () => {
    const out = await runFinalDecisionSynthesizer(ctx, input(null), { configured: true, callModel: async () => "invalid" });
    assert.equal(out.usedLLM, false);
    assert.equal(out.result, null);
  });
});
