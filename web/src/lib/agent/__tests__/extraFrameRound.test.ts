import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runFinalDecisionSynthesizer } from "@/lib/agent/agents/finalDecisionSynthesizer";
import type { FinalDecisionInput } from "@/lib/agent/agents/finalDecisionAgent";
import type { AgentMarketContext } from "@/lib/agent/marketContext/buildAgentMarketContext";
import type { AgentRunContext } from "@/lib/agent/types";
import { makeRisk, makeStructure } from "./helpers";

/**
 * The extra-frame round (plan §10 E): at most ONE second look, from a
 * whitelist, never a frame already shown, and the FIRST decision stands
 * whenever anything about the round fails.
 *
 * That last property is the contract. The round is an offer to refine, and an
 * offer must never become a dependency — a capture timeout that killed the
 * decision would turn a nice-to-have view into a single point of failure.
 */

const ctx: AgentRunContext = { requestId: "extra-frame-test", emitActivity: () => {} };

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

function input(snapshots: Array<{ timeframe: string }> = []) {
  return {
    userMessage: "analyze",
    risk: makeRisk({}),
    news: null,
    market: market(),
    structure: makeStructure(),
    supplyDemand: { zones: [], nearestDemand: null, nearestSupply: null },
    mtf: null,
    candidates: [],
    visualSnapshots: snapshots.map((s) => ({ ...s, imageBase64: "AAAA" })),
  } as unknown as FinalDecisionInput & { candidates: [] };
}

function answer(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    direction: "buy",
    planType: "conditional",
    selectedTradeCandidateId: null,
    proposedLevels: null,
    activationCondition: "إغلاق فوق 1.1005",
    invalidationRule: "إغلاق تحت 1.09.",
    alternativeScenario: "كسر 1.09 يقلب المشهد.",
    validityCandles: 6,
    confidence: 0.6,
    summary: "قرار EURUSD من الأدلة المرفقة أعلاه.",
    keyReasons: ["evidence"],
    riskWarnings: [],
    publicReasoningSummary: [],
    decisionTrace: {
      hypotheses: [{ scenario: "x", supporting: [], opposing: [] }],
      chosenBecause: "y.",
      planTypeBecause: "z.",
    },
    drawingAdvice: { shouldDraw: false, reason: "none" },
    requestExtraTimeframe: null,
    ...over,
  });
}

describe("the extra-frame round", () => {
  it("runs no second round when the model asks for nothing", async () => {
    let calls = 0;
    let captures = 0;
    const out = await runFinalDecisionSynthesizer(ctx, input(), {
      configured: true,
      callModel: async () => {
        calls += 1;
        return answer();
      },
      captureExtraFrame: async () => {
        captures += 1;
        return null;
      },
    });
    assert.equal(out.result?.decision, "buy");
    assert.equal(calls, 1, "null request must not trigger a second call");
    assert.equal(captures, 0);
  });

  it("attaches the requested frame and takes the second decision", async () => {
    let calls = 0;
    const out = await runFinalDecisionSynthesizer(ctx, input([{ timeframe: "5m" }]), {
      configured: true,
      callModel: async (_system, user) => {
        calls += 1;
        if (calls === 1) return answer({ requestExtraTimeframe: "4h" });
        // The second prompt names the round and forbids a third.
        assert.ok(user.includes("Second round"));
        assert.ok(user.includes("no third round"));
        return answer({ planType: "immediate", summary: "قرار بعد رؤية فريم 4h المطلوب." });
      },
      captureExtraFrame: async (timeframe) => {
        assert.equal(timeframe, "4h");
        return { timeframe, imageBase64: "BBBB" };
      },
    });
    assert.equal(calls, 2);
    assert.equal(out.result?.planType, "immediate", "the refined decision wins");
  });

  it("keeps the first decision when the capture fails", async () => {
    let calls = 0;
    const out = await runFinalDecisionSynthesizer(ctx, input(), {
      configured: true,
      callModel: async () => {
        calls += 1;
        return answer({ requestExtraTimeframe: "1h", planType: "conditional" });
      },
      captureExtraFrame: async () => null,
    });
    assert.equal(calls, 1, "no image, no second call");
    assert.equal(out.result?.planType, "conditional");
  });

  it("keeps the first decision when the second call fails", async () => {
    let calls = 0;
    const out = await runFinalDecisionSynthesizer(ctx, input(), {
      configured: true,
      callModel: async () => {
        calls += 1;
        if (calls === 1) return answer({ requestExtraTimeframe: "1h" });
        return "not json at all";
      },
      captureExtraFrame: async (tf) => ({ timeframe: tf, imageBase64: "CCCC" }),
    });
    assert.equal(calls, 2);
    // The offer failed; the decision from round one survives untouched.
    assert.equal(out.result?.decision, "buy");
  });

  it("refuses a frame outside the whitelist", async () => {
    let calls = 0;
    let captures = 0;
    await runFinalDecisionSynthesizer(ctx, input(), {
      configured: true,
      callModel: async () => {
        calls += 1;
        return answer({ requestExtraTimeframe: "3m" });
      },
      captureExtraFrame: async () => {
        captures += 1;
        return null;
      },
    });
    assert.equal(calls, 1);
    assert.equal(captures, 0, "an off-whitelist frame must not be captured");
  });

  it("refuses a frame that was already attached", async () => {
    let captures = 0;
    await runFinalDecisionSynthesizer(ctx, input([{ timeframe: "4h" }]), {
      configured: true,
      callModel: async () => answer({ requestExtraTimeframe: "4h" }),
      captureExtraFrame: async () => {
        captures += 1;
        return null;
      },
    });
    assert.equal(captures, 0, "re-requesting a shown frame is refused, not re-captured");
  });

  it("never grants a third round, whatever the second answer asks", async () => {
    let calls = 0;
    let captures = 0;
    await runFinalDecisionSynthesizer(ctx, input(), {
      configured: true,
      callModel: async () => {
        calls += 1;
        // BOTH rounds ask for more. The second request must be ignored.
        return answer({ requestExtraTimeframe: calls === 1 ? "1h" : "4h" });
      },
      captureExtraFrame: async (tf) => {
        captures += 1;
        return { timeframe: tf, imageBase64: "DDDD" };
      },
    });
    assert.equal(calls, 2, "exactly two model calls, never three");
    assert.equal(captures, 1, "exactly one capture, never two");
  });
});
