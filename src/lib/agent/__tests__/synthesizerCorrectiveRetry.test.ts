/**
 * Path A regression pins, from request 58a1aca3-9a26-4616-befb-2320f5151b14.
 *
 * Both production attempts failed on the same invalid activationRule because
 * the retry re-sent the identical prompt — the model repeated the identical
 * mistake, the 60s stage budget killed attempt 2 mid-flight, and the operator
 * saw a generic "timeout" for what was really a schema mismatch. These pin the
 * two behaviours that end that failure mode: the retry carries the validator's
 * objections, and a valid-but-lazy rule (no timeframe) is normalized rather
 * than refused.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runFinalDecisionSynthesizer } from "@/lib/agent/agents/finalDecisionSynthesizer";
import type { FinalDecisionInput } from "@/lib/agent/agents/finalDecisionAgent";
import type { AgentMarketContext } from "@/lib/agent/marketContext/buildAgentMarketContext";
import type { AgentRunContext } from "@/lib/agent/types";
import type { RiskAgentResult } from "@/lib/agent/agents/riskAgent";
import type { TradeCandidate } from "@/lib/agent/trading/buildTradeCandidates";
import { makeRisk, makeStructure } from "./helpers";

const ctx: AgentRunContext = { requestId: "retry-test", emitActivity: () => {} };

function market(): AgentMarketContext {
  return {
    // Price sits just under 4000 on purpose. The plan here is "return to the
    // demand zone, then confirm with a close above 4000" — and a validator
    // added after these pins were written refuses a condition that is ALREADY
    // true, which at the fixture's old 4014 it was. The fixture was describing
    // a plan that would activate on the next candle with no real condition,
    // and every assertion below drowned in that one rejection.
    symbol: "XAUUSD", interval: "15m", currentPrice: 3998, marketRegime: "range", atr: 6,
    dataQuality: { currentTfCount: 600, higherTfCount: 250, dailyCount: 120, sufficient: true, policyVersion: "1.1.0" },
    currentTfCandles: [], higherTfCandles: [], dailyCandles: [],
    majorLevels: { support: [{ price: 3980, time: 1 }], resistance: [{ price: 4040, time: 2 }] },
    zones: [{ type: "demand", low: 3990, high: 4000, time: 3 }],
    liquidity: { equalHighs: [], equalLows: [], nearestBuySide: null, nearestSellSide: null },
  } as unknown as AgentMarketContext;
}

function candidate(): TradeCandidate {
  return {
    id: "buy-1", action: "buy", entry: 3996, entryType: "limit",
    stop_loss: 3992, targets: [4030, 4045], rr: 2, netRr: 1.9, netRrTp2: 3,
    activationClass: "conditional", activationDistance: 18, activationDistanceAtr: 3,
    qualityScore: 0.8,
    triggerCondition: "العودة إلى منطقة الطلب وإغلاق شمعة 15 دقيقة فوق 4000",
    setupType: "demand_retest",
    poi: { type: "demand", low: 3990, high: 4000,
      score: { score: 80, grade: "A", reasons: [], warnings: [], isTradable: true } },
    evidence: ["real evidence"], warnings: [], invalidationReason: "structure invalidated",
  } as unknown as TradeCandidate;
}

function input(): FinalDecisionInput & { candidates: [] } {
  const c = candidate();
  const risk: RiskAgentResult = makeRisk({
    candidatesResult: { candidates: [c], best: c, rejectedReasons: [], hasReversalEvidence: false },
    selectedCandidate: c,
  });
  return {
    userMessage: "أعطني توصية على الذهب", risk, news: null, market: market(),
    structure: makeStructure(), supplyDemand: { zones: [], nearestDemand: null, nearestSupply: null },
    mtf: null, candidates: [],
  } as unknown as FinalDecisionInput & { candidates: [] };
}

function modelAnswer(activationRule: unknown): string {
  return JSON.stringify({
    direction: "buy",
    planType: "conditional",
    selectedTradeCandidateId: "buy-1",
    proposedLevels: null,
    activationCondition: "عودة السعر إلى منطقة الطلب ثم إغلاق شمعة 15 دقيقة فوق 4000.",
    activationRule,
    invalidationRule: "إغلاق شمعة 15 دقيقة تحت 3992 يلغي الفكرة.",
    alternativeScenario: "كسر 3992 يفتح مسارًا هابطًا نحو 3980.",
    validityCandles: 12,
    confidence: 0.66,
    summary: "شراء مشروط للذهب بعد إعادة اختبار منطقة الطلب وتأكيد الإغلاق فوق 4000.",
    keyReasons: ["منطقة طلب صامدة"],
    riskWarnings: ["خطة مشروطة"],
    publicReasoningSummary: ["إعادة الاختبار ثم التأكيد"],
    decisionTrace: {
      hypotheses: [{ scenario: "ارتداد من الطلب", supporting: ["بنية صاعدة"], opposing: [] }],
      chosenBecause: "الطلب صمد مرتين.",
      planTypeBecause: "السعر خارج منطقة الدخول الآن.",
    },
    drawingAdvice: { shouldDraw: false, reason: "none" },
  });
}

describe("corrective retry", () => {
  it("attempt 2 carries the validator's objections instead of repeating blind", async () => {
    const userMessages: string[] = [];
    const out = await runFinalDecisionSynthesizer(ctx, input(), {
      configured: true,
      callModel: async (_system, user) => {
        userMessages.push(user);
        // Attempt 1: an ungradable rule kind → schema_mismatch, retryable.
        if (userMessages.length === 1) return modelAnswer({ kind: "teleport", level: 4000 });
        // Attempt 2: the corrected, minimal rule.
        return modelAnswer({ kind: "candle_close_above", level: 4000 });
      },
    });
    assert.equal(userMessages.length, 2, "one retry");
    assert.ok(
      userMessages[1]!.includes("SCHEMA CORRECTION"),
      "the retry names the correction",
    );
    assert.ok(
      userMessages[1]!.includes("activationRule"),
      "the retry names the offending field",
    );
    assert.equal(out.usedLLM, true);
    assert.equal(out.result?.decision, "buy");
  });

  it("the incident composite parses on attempt 1 — no retry needed at all", async () => {
    let calls = 0;
    const out = await runFinalDecisionSynthesizer(ctx, input(), {
      configured: true,
      callModel: async () => {
        calls += 1;
        // Verbatim incident shape: touch leaf with no direction, no timeframe.
        return modelAnswer({
          kind: "composite",
          operator: "all",
          rules: [
            { kind: "price_touch", level: 4000 },
            { kind: "candle_close_above", level: 4000, timeframe: "15m" },
          ],
        });
      },
    });
    assert.equal(calls, 1, "the shape that burned both production attempts now parses");
    assert.equal(out.result?.decision, "buy");
  });

  it("a lazy leaf is normalized with the plan's timeframe before storage", async () => {
    const out = await runFinalDecisionSynthesizer(ctx, input(), {
      configured: true,
      callModel: async () => modelAnswer({ kind: "candle_close_above", level: 4000 }),
    });
    const rule = out.result?.recommendation.activationRule;
    assert.ok(rule && rule.kind === "candle_close_above");
    if (rule && rule.kind === "candle_close_above") {
      assert.equal(rule.timeframe, "15m", "the plan's own timeframe is filled in");
    }
  });
});
