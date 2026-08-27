import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";
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
          activationCondition: "لمس 1.095 من الطلب.",
          activationRule: { kind: "price_touch", level: 1.095, timeframe: "5m" },
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
    // Live 1.1 is already through the buy entry at 1.095 — leftover wait
    // converts to immediate follow-through rather than sitting pending.
    assert.equal(out.result?.planType, "immediate");
    assert.equal(out.result?.executionState, "valid_now");
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

  it("converts a conditional sell whose activation already printed into immediate follow-through", async () => {
    // Production card: 5m XAUUSD SELL, entry 4616.66, rejection-wait,
    // live ~4606 already through in the sell direction. Shipping that as
    // pending_entry/conditional was the complaint — the wait is over.
    const gold = {
      ...market(),
      symbol: "XAUUSD",
      interval: "5m",
      currentPrice: 4606,
      atr: 8.9,
      spread: 0.3,
    };
    const sell: TradeCandidate = {
      ...candidate("sell-incident", "sell"),
      entry: 4616.66,
      entryType: "sell_limit",
      stop_loss: 4618.88,
      targets: [4603.33, 4593.8, 4593.71],
      rr: 6,
      netRr: 5.5,
      netRrTp2: 10,
      activationClass: "conditional",
      poi: {
        type: "supply",
        low: 4614,
        high: 4618,
        score: { score: 80, grade: "A", reasons: [], warnings: [], isTradable: true },
      },
    };
    const out = await runFinalDecisionSynthesizer(
      ctx,
      { ...input(evidence(sell), { market: gold }), locale: "en" },
      {
        configured: true,
        callModel: async () =>
          model({
            direction: "sell",
            planType: "conditional",
            selectedTradeCandidateId: "sell-incident",
            activationCondition:
              "Price reaches 4616.66 then rejects: wick through and 5m close below it.",
            activationRule: {
              kind: "rejection_confirmed",
              level: 4616.66,
              direction: "below",
              timeframe: "5m",
            },
            invalidationRule: "A 5m close above 4618.88 kills the idea.",
            alternativeScenario: "A reclaim of 4616.66 flips the plan to a buy retest.",
            summary: "XAUUSD 5m sell after the rejection at 4616.66.",
          }),
      },
    );
    assert.equal(out.result?.decision, "sell");
    assert.equal(out.result?.planType, "immediate");
    assert.equal(out.result?.executionState, "valid_now");
    assert.notEqual(out.result?.recommendation.status, "pending_entry");
    assert.equal(out.result?.recommendation.activationRule, undefined);
    assert.equal(out.result?.recommendation.entryType, "market");
    assert.ok(
      Math.abs((out.result?.recommendation.entry ?? 0) - 4616.66) < 0.5,
      `through-print keeps the written entry 4616.66, got ${out.result?.recommendation.entry}`,
    );
    const tps = out.result?.recommendation.targets ?? [];
    assert.ok(tps.length >= 1 && tps.length <= 2, `expected 1–2 spaced TPs, got ${tps.join(",")}`);
    assert.ok(
      !tps.some((p) => Math.abs(p - 4593.71) < 0.05),
      `TP3 4593.71 must be omitted as a collapsed neighbour; got ${tps.join(",")}`,
    );
    const gaps = tps.slice(1).map((p, i) => Math.abs(p - tps[i]!));
    assert.ok(
      gaps.every((g) => g + 1e-9 >= 5),
      `consecutive TPs must clear the gold floor of 5; gaps ${gaps.join(",")}`,
    );
  });

  it("converts the 4605.39 / 4601.89 screenshot sell into immediate follow-through", async () => {
    const print = Date.UTC(2026, 7, 27, 17, 25, 0);
    const bar = 5 * 60_000;
    const gold = {
      ...market(),
      symbol: "XAUUSD",
      interval: "5m",
      currentPrice: 4601.89,
      atr: 8.9,
      spread: 0.3,
      currentTfCandles: [
        { time: print, open: 4607, high: 4608, low: 4604.2, close: 4605 },
        { time: print + 2 * bar, open: 4604, high: 4604, low: 4600.5, close: 4601.5 },
        { time: print + 10 * bar, open: 4602, high: 4603, low: 4601.2, close: 4601.89 },
      ],
    };
    const sell: TradeCandidate = {
      ...candidate("sell-shot", "sell"),
      entry: 4605.39,
      entryType: "sell_limit",
      stop_loss: 4606.86,
      targets: [4596.89, 4591.06],
      rr: 6,
      netRr: 5.5,
      netRrTp2: 10,
      activationClass: "conditional",
      poi: {
        type: "supply",
        low: 4604,
        high: 4607,
        score: { score: 80, grade: "A", reasons: [], warnings: [], isTradable: true },
      },
    };
    const out = await runFinalDecisionSynthesizer(
      ctx,
      { ...input(evidence(sell), { market: gold }), locale: "en" },
      {
        configured: true,
        callModel: async () =>
          model({
            direction: "sell",
            planType: "conditional",
            selectedTradeCandidateId: "sell-shot",
            activationCondition: "Wait for price to touch 4605.39 then reject.",
            activationRule: {
              kind: "rejection_confirmed",
              level: 4605.39,
              direction: "below",
              timeframe: "5m",
            },
            invalidationRule: "A 5m close above 4606.86 kills the idea.",
            alternativeScenario: "A reclaim flips the plan.",
            summary: "XAUUSD 5m sell.",
          }),
      },
    );
    assert.equal(out.result?.planType, "immediate");
    assert.equal(out.result?.executionState, "valid_now");
    assert.notEqual(out.result?.recommendation.status, "pending_entry");
    assert.ok(
      Math.abs((out.result?.recommendation.entry ?? 0) - 4605.39) < 0.05,
      `through-print keeps 4605.39, got ${out.result?.recommendation.entry}`,
    );
    assert.equal(out.result?.recommendation.anchorTime, print);
  });

  it("instructs a before-and-after visual review and the production follow-through example", () => {
    const src = readFileSync(
      path.join(import.meta.dirname, "..", "agents", "finalDecisionSynthesizer.ts"),
      "utf8",
    );
    assert.match(src, /BEFORE proposing any level/);
    assert.match(src, /AFTER you have proposed levels/);
    assert.match(src, /4616\.66/);
    assert.match(src, /4606/);
    assert.match(src, /4605\.39/);
    assert.match(src, /4601\.89/);
    assert.match(src, /planType:"immediate"/);
    assert.match(src, /false breakout/i);
    assert.match(src, /pin bar/i);
    assert.match(src, /engulfing/i);
    assert.match(src, /trendline may BE the actual entry/i);
    assert.match(src, /BREAK or from the RETEST/);
    assert.match(src, /supply\/demand/i);
    assert.match(src, /Gaps:/);
    assert.match(src, /News:/);
    assert.match(src, /10–15/);
    assert.match(src, /LENGTH \(presentational/);
    assert.match(src, /608da3bf/);
  });
});

describe("presentational overflow and recoverable aliases are not contract faults", () => {
  /**
   * Production 2026-08-27, request 608da3bf-80a8-44d3-816d-8b0fabf1c2d6,
   * Claude Fable 5, 167.7s. Attempt 1: planTypeBecause >400 characters.
   * Attempt 2: summary >900. Both replies were complete JSON with direction,
   * planType, candidate, activationRule. Zod `.max()` threw the whole plan
   * away; the card would have sliced the same strings a few lines later.
   */
  function incidentAnswer(over: Record<string, unknown> = {}) {
    return model({
      selectedTradeCandidateId: "buy-1",
      planType: "immediate",
      summary: `تحليل XAUUSD على 5m: ${"السعر يعيد اختبار المنطقة والشرط تحقق. ".repeat(40)}`,
      decisionTrace: {
        hypotheses: [
          {
            scenario: "ارتداد من الطلب",
            supporting: ["هيكل صاعد"],
            opposing: ["سبريد واسع"],
          },
        ],
        chosenBecause: `الطلب صمد والشرط طُبع عند السعر الحي. ${"تفاصيل إضافية عن البنية. ".repeat(20)}`,
        planTypeBecause: `السيناريو تحقق سلفاً — الدخول فوري لا انتظار لمس ثانٍ. ${"شرح العقيدة حرفياً مع الاستراتيجيات. ".repeat(20)}`,
      },
      ...over,
    });
  }

  it("the 608da3bf Fable 5 shape (oversize summary + planTypeBecause) parses on attempt 1", async () => {
    const buy = candidate("buy-1", "buy");
    let calls = 0;
    const raw = incidentAnswer();
    const parsed = JSON.parse(raw) as {
      summary: string;
      decisionTrace: { planTypeBecause: string; chosenBecause: string };
    };
    assert.ok(parsed.summary.length > 900, "fixture must exceed the old summary cap");
    assert.ok(
      parsed.decisionTrace.planTypeBecause.length > 400,
      "fixture must exceed the old planTypeBecause cap",
    );
    assert.ok(
      parsed.decisionTrace.chosenBecause.length > 400,
      "fixture must exceed the old chosenBecause cap",
    );

    const out = await runFinalDecisionSynthesizer(ctx, input(evidence(buy)), {
      configured: true,
      callModel: async () => {
        calls += 1;
        return raw;
      },
    });
    assert.equal(calls, 1, "trimming must not spend the corrective retry");
    assert.equal(out.failure, undefined);
    assert.equal(out.result?.decision, "buy");
    assert.ok((out.result?.summary.length ?? 0) <= 900);
    assert.ok((out.result?.decisionTrace?.planTypeBecause.length ?? 0) <= 400);
    assert.ok((out.result?.decisionTrace?.chosenBecause.length ?? 0) <= 400);
  });

  it("accepts proposedLevels aliases entry/stop the model sent instead of preferredEntry/stopLoss", async () => {
    // Live 2026-08-27 19:26: المُرسَل entry:number, stopLoss:number, targets:array
    // died as preferredEntry received undefined. Same family as the
    // schemaMismatchShape fixture (entry/stop/targets).
    const out = await runFinalDecisionSynthesizer(ctx, input(null), {
      configured: true,
      callModel: async () =>
        model({
          direction: "buy",
          planType: "conditional",
          selectedTradeCandidateId: null,
          activationCondition: "لمس 1.095 من الطلب.",
          activationRule: { kind: "price_touch", level: "1.095", timeframe: "5m" },
          proposedLevels: { entry: 1.095, stop: 1.09, targets: [1.12] },
        }),
    });
    assert.equal(out.failure, undefined);
    assert.equal(out.result?.decision, "buy");
    assert.equal(out.result?.recommendation.entry, 1.095);
    assert.equal(out.result?.recommendation.levelSource, "evidence_levels");
  });

  it("defaults a missing drawingAdvice instead of rejecting a complete plan", async () => {
    const buy = candidate("buy-1", "buy");
    const out = await runFinalDecisionSynthesizer(ctx, input(evidence(buy)), {
      configured: true,
      callModel: async () => model({ selectedTradeCandidateId: "buy-1", drawingAdvice: undefined }),
    });
    assert.equal(out.result?.decision, "buy");
    assert.equal(out.drawingAdvice?.shouldDraw, true);
  });

  it("still rejects a missing direction — honesty gates are not loosened", async () => {
    const out = await runFinalDecisionSynthesizer(ctx, input(null), {
      configured: true,
      callModel: async () => model({ direction: "wait", summary: "x".repeat(950) }),
    });
    assert.equal(out.result, null);
    assert.equal(out.failure?.kind, "schema_mismatch");
  });

  it("still rejects a summary too short to be a decision", async () => {
    const buy = candidate("buy-1", "buy");
    const out = await runFinalDecisionSynthesizer(ctx, input(evidence(buy)), {
      configured: true,
      callModel: async () => model({ selectedTradeCandidateId: "buy-1", summary: "قصير" }),
    });
    assert.equal(out.result, null);
    assert.equal(out.failure?.kind, "schema_mismatch");
  });
});
