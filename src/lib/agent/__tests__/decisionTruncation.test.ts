/**
 * The blocking live defect: every analysis died at exactly 95.0s.
 *
 * What actually happened on the server, established from the code and pinned
 * here so it cannot come back:
 *
 *   1. The active model is `claude-sonnet-4-6`. `decisionMaxTokens()` handed
 *      3072 output tokens to anything `isReasoningModel()` did not match —
 *      and that only ever matched o-series and gpt-5, so EVERY Claude model
 *      got the small budget. `requestBudget()` then capped it at 4096 anyway.
 *   2. The decision is one large JSON object written in Arabic, which costs
 *      several times more tokens per character than English. It did not fit.
 *      The provider stopped at the ceiling and said so: `stop_reason:
 *      "max_tokens"`.
 *   3. Nothing read `stop_reason`. The truncated text went to `JSON.parse`,
 *      threw a SyntaxError, and was classified `invalid_json` — "retryable".
 *   4. The retry re-sent the identical call with the identical ceiling and
 *      truncated identically. Two full model calls consumed the 95s stage
 *      deadline, and the operator saw "the final decision did not finish
 *      within the allowed time" with nothing naming the budget.
 *
 * The same trap was found and fixed on the OpenAI path long ago
 * (openaiCompat.ts, REASONING_MIN_TOKENS) — which is why analysis worked on
 * gpt-5 and stopped the day the provider was switched to Anthropic. Two
 * surfaces, one cause: web and Telegram both run this function.
 *
 * None of these tests raise the stage deadline. They pin that the step no
 * longer needs the extra time.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DECISION_ATTEMPT_TIMEOUT_MS,
  DECISION_OUTPUT_TOKENS,
  DECISION_OUTPUT_TOKENS_RETRY,
  TruncatedDecisionError,
  classifySynthesizerError,
  runFinalDecisionSynthesizer,
} from "@/lib/agent/agents/finalDecisionSynthesizer";
import { AGENT_TIMEOUTS } from "@/lib/agent/timeout";
import type { FinalDecisionInput } from "@/lib/agent/agents/finalDecisionAgent";
import type { AgentMarketContext } from "@/lib/agent/marketContext/buildAgentMarketContext";
import type { AgentRunContext } from "@/lib/agent/types";
import type { RiskAgentResult } from "@/lib/agent/agents/riskAgent";
import type { TradeCandidate } from "@/lib/agent/trading/buildTradeCandidates";
import { makeRisk, makeStructure } from "./helpers";

const ctx: AgentRunContext = { requestId: "truncation-test", emitActivity: () => {} };

function market(): AgentMarketContext {
  return {
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

/** A complete, valid decision — what the model returns when it has room. */
function goodAnswer(): string {
  return JSON.stringify({
    direction: "buy",
    planType: "conditional",
    selectedTradeCandidateId: "buy-1",
    proposedLevels: null,
    activationCondition: "عودة السعر إلى منطقة الطلب ثم إغلاق شمعة 15 دقيقة فوق 4000.",
    activationRule: { kind: "candle_close_above", level: 4000, timeframe: "15m" },
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

describe("the decision gets an output budget that fits the answer it must write", () => {
  it("every model is budgeted for the schema — not just the ones a regex happened to name", () => {
    // The bug in one line: the old code branched on `isReasoningModel`, which
    // matches only /^o\d/ and /^gpt-5/, so Claude fell to 3072. The schema is
    // the same object whoever writes it, so the budget is one number now.
    assert.ok(
      DECISION_OUTPUT_TOKENS >= 8000,
      "an Arabic decision JSON does not fit in a few thousand tokens",
    );
    assert.ok(
      DECISION_OUTPUT_TOKENS_RETRY > DECISION_OUTPUT_TOKENS,
      "a truncation retry must have MORE room, or it just truncates again",
    );
  });

  it("the per-attempt budget leaves room for the retry the loop promises", () => {
    // The inversion that hid every cause: the HTTP timeout (120s) outlived the
    // stage deadline (95s), so attempt 1 either answered or held the line until
    // the stage died — the retry could never run, and the failure could never
    // name the provider.
    assert.ok(
      DECISION_ATTEMPT_TIMEOUT_MS < AGENT_TIMEOUTS.finalDecision,
      "one attempt must not be able to spend the whole stage",
    );
    assert.ok(
      DECISION_ATTEMPT_TIMEOUT_MS * 2 + 700 <= AGENT_TIMEOUTS.finalDecision,
      "two attempts plus the pause must fit inside the stage deadline",
    );
  });
});

describe("a truncated reply is named, not disguised as bad JSON", () => {
  it("classifies as `truncated` and stays retryable", () => {
    const classified = classifySynthesizerError(new TruncatedDecisionError(3072));
    assert.equal(classified.kind, "truncated");
    assert.equal(classified.retryable, true);
    assert.match(classified.detail, /3072/, "the operator is told which ceiling was hit");
  });

  it("is NOT swallowed by the invalid_json branch", () => {
    // A truncated object also fails JSON.parse. Before the fix that is exactly
    // where it landed, and `invalid_json` says nothing about the budget.
    const truncated = classifySynthesizerError(new TruncatedDecisionError(3072));
    const badJson = classifySynthesizerError(new SyntaxError("Unexpected end of JSON input"));
    assert.equal(badJson.kind, "invalid_json");
    assert.notEqual(truncated.kind, badJson.kind, "the two causes must stay distinguishable");
  });
});

describe("the acceptance case: a real recommendation, not a timeout", () => {
  it("a truncated first attempt still produces a plan on the retry", async () => {
    let calls = 0;
    const out = await runFinalDecisionSynthesizer(ctx, input(), {
      configured: true,
      callModel: async () => {
        calls += 1;
        // Attempt 1 is cut off at the ceiling — the live failure.
        if (calls === 1) throw new TruncatedDecisionError(DECISION_OUTPUT_TOKENS);
        return goodAnswer();
      },
    });
    assert.equal(calls, 2, "the retry actually runs");
    assert.equal(out.usedLLM, true);
    // The whole point: an ANSWER reaches the operator.
    assert.equal(out.result?.decision, "buy");
    assert.ok(out.result?.summary, "with a summary, not an empty shell");
  });

  it("two truncations in a row fail by NAME, never as an anonymous timeout", async () => {
    const out = await runFinalDecisionSynthesizer(ctx, input(), {
      configured: true,
      callModel: async () => {
        throw new TruncatedDecisionError(DECISION_OUTPUT_TOKENS);
      },
    });
    assert.equal(out.result, null);
    assert.equal(out.failure?.kind, "truncated");
    assert.notEqual(
      out.failure?.kind,
      "timeout",
      "the operator must never again be told 'ran out of time' for a budget fault",
    );
  });

  it("an untruncated model answers on the first attempt", async () => {
    let calls = 0;
    const out = await runFinalDecisionSynthesizer(ctx, input(), {
      configured: true,
      callModel: async () => {
        calls += 1;
        return goodAnswer();
      },
    });
    assert.equal(calls, 1, "no wasted attempt when the budget is adequate");
    assert.equal(out.result?.decision, "buy");
  });
});
