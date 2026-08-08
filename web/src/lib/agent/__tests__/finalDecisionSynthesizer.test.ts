import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  runFinalDecisionSynthesizer,
  shouldCoerceImmediateOnConflict,
} from "@/lib/agent/agents/finalDecisionSynthesizer";
import type { FinalDecisionInput } from "@/lib/agent/agents/finalDecisionAgent";
import type { AgentMarketContext } from "@/lib/agent/marketContext/buildAgentMarketContext";
import type { AgentRunContext } from "@/lib/agent/types";
import type { RiskAgentResult } from "@/lib/agent/agents/riskAgent";
import type { TradeCandidate } from "@/lib/agent/trading/buildTradeCandidates";
import { makeRisk, makeStructure } from "./helpers";

const ctx: AgentRunContext = { requestId: "test", emitActivity: () => {} };

function market(): AgentMarketContext {
  return {
    symbol: "EURUSD", interval: "5m", currentPrice: 1.1, marketRegime: "range", atr: 0.002,
    dataQuality: { currentTfCount: 600, higherTfCount: 250, dailyCount: 120, sufficient: true, policyVersion: "1.1.0" },
    currentTfCandles: [], higherTfCandles: [], dailyCandles: [],
    majorLevels: { support: [{ price: 1.09, time: 1 }], resistance: [{ price: 1.12, time: 2 }] },
    zones: [{ type: "demand", low: 1.095, high: 1.1, time: 3 }],
    liquidity: { equalHighs: [], equalLows: [], nearestBuySide: null, nearestSellSide: null },
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

function input(
  risk: RiskAgentResult | null,
  over: Partial<FinalDecisionInput> = {},
): FinalDecisionInput & { candidates: [] } {
  return {
    userMessage: "analyze",
    risk,
    news: null,
    market: market(),
    structure: makeStructure(),
    supplyDemand: { zones: [], nearestDemand: null, nearestSupply: null },
    mtf: null,
    candidates: [],
    ...over,
  };
}

/** A complete model answer under the three-layer contract. */
function model(over: Record<string, unknown> = {}) {
  return JSON.stringify({
    direction: "buy",
    planType: "immediate",
    selectedTradeCandidateId: null,
    proposedLevels: null,
    activationCondition: null,
    invalidationRule: "إغلاق شمعة تحت 1.09 يبطل الفكرة.",
    alternativeScenario: "كسر 1.09 يقلب المشهد إلى بيع نحو 1.08.",
    validityCandles: 6,
    confidence: 0.6,
    summary: "Specific EURUSD market decision from the supplied evidence.",
    keyReasons: ["evidence"],
    riskWarnings: [],
    publicReasoningSummary: ["public evidence"],
    decisionTrace: {
      hypotheses: [{ scenario: "ارتداد من الطلب", supporting: ["هيكل صاعد"], opposing: ["سبريد واسع"] }],
      chosenBecause: "الطلب صمد مرتين.",
      planTypeBecause: "السعر داخل المنطقة الآن.",
    },
    drawingAdvice: { shouldDraw: false, reason: "none" },
    ...over,
  });
}

describe("AI final decision authority", () => {
  it("returns the three layers on every successful analysis", async () => {
    const buy = candidate("buy-1", "buy");
    const out = await runFinalDecisionSynthesizer(ctx, input(evidence(buy)), {
      configured: true,
      callModel: async () => model({ selectedTradeCandidateId: "buy-1" }),
    });
    assert.equal(out.usedLLM, true);
    assert.equal(out.result?.decision, "buy");
    assert.equal(out.result?.planType, "immediate");
    assert.equal(out.result?.executionState, "valid_now");
    assert.match(out.result?.summary ?? "", /EURUSD/);
    // The plan is complete: levels, what kills it, what replaces it, how long.
    assert.equal(out.result?.recommendation.stop_loss, buy.stop_loss);
    assert.ok(out.result?.recommendation.invalidationRule);
    assert.ok(out.result?.recommendation.alternativeScenario);
    assert.equal(out.result?.recommendation.validityCandles, 6);
    assert.ok(out.result?.decisionTrace?.chosenBecause);
    assert.ok((out.result?.evidenceDimensions ?? []).length > 5);
  });

  it("rejects a model answer with no direction", async () => {
    const out = await runFinalDecisionSynthesizer(ctx, input(null), {
      configured: true,
      callModel: async () => model({ direction: "wait" }),
    });
    // Not a decision the contract can express — a schema fault, not a "wait".
    assert.equal(out.result, null);
    assert.equal(out.failure?.kind, "schema_mismatch");
  });

  it("may choose either side from real opposing candidates", async () => {
    const buy = candidate("buy-1", "buy");
    const sell = candidate("sell-1", "sell");
    const out = await runFinalDecisionSynthesizer(ctx, input(evidence(buy, sell)), {
      configured: true,
      callModel: async () => model({ direction: "sell", selectedTradeCandidateId: "sell-1", confidence: 0.9 }),
    });
    assert.equal(out.result?.decision, "sell");
    assert.equal(out.result?.recommendation.stop_loss, sell.stop_loss);
  });

  it("high news remains evidence and never removes the direction", async () => {
    const buy = candidate("buy-1", "buy");
    const base = input(evidence(buy));
    const out = await runFinalDecisionSynthesizer(ctx, { ...base, news: { newsRisk: "high", biasImpact: "unknown", affectedCurrencies: [], upcomingEvents: [], tradeAllowed: false, reason: "event" } }, {
      configured: true,
      callModel: async () =>
        model({
          direction: "buy",
          planType: "conditional",
          selectedTradeCandidateId: "buy-1",
          activationCondition: "بعد انتهاء الحركة الأولى للخبر واستعادة 1.10.",
          activationRule: { kind: "candle_close_above", level: 1.1, timeframe: "5m" },
          confidence: 0.95,
        }),
    });
    assert.equal(out.result?.decision, "buy");
    assert.equal(out.result?.planType, "conditional");
    assert.equal(out.result?.executionState, "awaiting_activation");
  });

  it("keeps the direction when no candidate matches, without inventing levels", async () => {
    const out = await runFinalDecisionSynthesizer(ctx, input(null), {
      configured: true,
      callModel: async () => model({ direction: "sell", selectedTradeCandidateId: "invented" }),
    });
    assert.equal(out.result?.decision, "sell");
    assert.equal(out.result?.recommendation.action, "sell");
    assert.equal(out.result?.recommendation.stop_loss, undefined);
    assert.match(out.result?.riskWarnings[0] ?? "", /مستويات/);
  });

  it("accepts proposed levels that come from the evidence menu", async () => {
    const out = await runFinalDecisionSynthesizer(ctx, input(null), {
      configured: true,
      callModel: async () =>
        model({
          direction: "buy",
          planType: "conditional",
          selectedTradeCandidateId: null,
          activationCondition: "رفض صاعد من 1.095.",
          activationRule: { kind: "rejection_confirmed", level: 1.095, direction: "above", timeframe: "5m" },
          proposedLevels: {
            entryLow: 1.095,
            entryHigh: 1.1,
            preferredEntry: 1.095,
            stopLoss: 1.09,
            targets: [1.12],
          },
        }),
    });
    assert.equal(out.result?.recommendation.entry, 1.095);
    assert.equal(out.result?.recommendation.levelSource, "evidence_levels");
    assert.equal(out.result?.executionState, "awaiting_activation");
  });

  it("refuses invented levels but keeps the direction and the reasoning", async () => {
    const out = await runFinalDecisionSynthesizer(ctx, input(null), {
      configured: true,
      callModel: async () =>
        model({
          direction: "buy",
          planType: "conditional",
          activationCondition: "رفض صاعد من 1.095.",
          activationRule: { kind: "rejection_confirmed", level: 1.095, direction: "above", timeframe: "5m" },
          proposedLevels: {
            preferredEntry: 1.0777,
            stopLoss: 1.0501,
            targets: [1.2345],
          },
        }),
    });
    assert.equal(out.result?.decision, "buy");
    assert.equal(out.result?.recommendation.entry, undefined);
    assert.match(out.result?.riskWarnings[0] ?? "", /لم تُطابق/);
    assert.ok(out.result?.decisionTrace?.chosenBecause);
  });

  it("model/schema failure returns no market decision", async () => {
    const out = await runFinalDecisionSynthesizer(ctx, input(null), { configured: true, callModel: async () => "invalid" });
    assert.equal(out.usedLLM, false);
    assert.equal(out.result, null);
  });

  it("coerces immediate+MTF conflict to conditional awaiting activation", async () => {
    assert.equal(
      shouldCoerceImmediateOnConflict({
        planType: "immediate",
        mtfConflict: true,
      }),
      true,
    );
    assert.equal(
      shouldCoerceImmediateOnConflict({
        planType: "conditional",
        mtfConflict: true,
      }),
      false,
    );

    const buy = candidate("buy-1", "buy");
    const sell = candidate("sell-1", "sell");
    const out = await runFinalDecisionSynthesizer(
      ctx,
      {
        ...input(evidence(buy, sell), {
          mtf: {
            currentBias: "bullish",
            higherBias: "bearish",
            dailyBias: "bearish",
            conflict: true,
          },
        }),
        locale: "en",
      },
      {
        configured: true,
        callModel: async () =>
          model({
            selectedTradeCandidateId: "buy-1",
            planType: "immediate",
            timeframeRoles: { lead: "5m", context: "1h", timing: "5m" },
            publicReasoningSummary: ["demand held twice"],
          }),
      },
    );
    assert.equal(out.result?.planType, "conditional");
    assert.equal(out.result?.executionState, "awaiting_activation");
    assert.ok(out.result?.recommendation.activationRule);
    assert.ok(
      (out.result?.publicReasoningSummary ?? []).some((l) =>
        /Adopted scenario|alternative/i.test(l),
      ),
      JSON.stringify(out.result?.publicReasoningSummary),
    );
  });
});
