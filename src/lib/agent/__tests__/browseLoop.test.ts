import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runFinalDecisionSynthesizer } from "@/lib/agent/agents/finalDecisionSynthesizer";
import type { FinalDecisionInput } from "@/lib/agent/agents/finalDecisionAgent";
import type { AgentMarketContext } from "@/lib/agent/marketContext/buildAgentMarketContext";
import type { AgentRunContext } from "@/lib/agent/types";
import { makeRisk, makeStructure } from "./helpers";
import { MAX_BROWSE_CALLS } from "@/lib/agent/browse/browseRequest";

/**
 * The browse loop: the brain reads the chart with its own hands.
 *
 * It may ask for a frame, for raw candles, or for what price did at a band —
 * one question per round, answer back, full decision re-issued. What these
 * tests hold is that every one of its four bounds is real (call budget, wall
 * clock, whitelist, repeat guard) and, above all, that ANY failure keeps the
 * decision already in hand.
 *
 * That last property is the contract. Browsing is an offer to refine, and an
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
    activationRule: { kind: "candle_close_above", level: 1.1005, timeframe: "5m" },
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
    browse: null,
    ...over,
  });
}

const view = (timeframe: string) => ({ verb: "view_timeframe", timeframe });

describe("the browse loop", () => {
  it("runs no round when the model asks for nothing", async () => {
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
    assert.equal(calls, 1, "a null request must not trigger a second call");
    assert.equal(captures, 0);
  });

  it("attaches the requested frame and takes the refined decision", async () => {
    let calls = 0;
    const out = await runFinalDecisionSynthesizer(ctx, input([{ timeframe: "5m" }]), {
      configured: true,
      callModel: async (_system, user) => {
        calls += 1;
        if (calls === 1) return answer({ browse: view("4h") });
        // The follow-up carries the transcript and the remaining budget.
        assert.ok(user.includes("Chart reading"));
        assert.ok(user.includes("view_timeframe"));
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

  it("reads candles as numbers without capturing an image", async () => {
    let calls = 0;
    let captures = 0;
    let asked: { timeframe: string; count: number } | null = null;
    await runFinalDecisionSynthesizer(ctx, input(), {
      configured: true,
      callModel: async (_system, user) => {
        calls += 1;
        if (calls === 1) {
          return answer({ browse: { verb: "read_candles", timeframe: "15m", count: 3 } });
        }
        assert.ok(user.includes("Last 3 15m candles"), "the bars come back as a table");
        return answer();
      },
      captureExtraFrame: async () => {
        captures += 1;
        return null;
      },
      readCandles: async (timeframe, count) => {
        asked = { timeframe, count };
        return [
          { time: 1, open: 1.1, high: 1.2, low: 1.0, close: 1.15 },
          { time: 2, open: 1.15, high: 1.25, low: 1.1, close: 1.2 },
          { time: 3, open: 1.2, high: 1.3, low: 1.15, close: 1.25 },
        ];
      },
    });
    assert.deepEqual(asked, { timeframe: "15m", count: 3 });
    assert.equal(captures, 0, "reading numbers must not render a chart");
  });

  it("answers read_zone from the same candles, never a separate story", async () => {
    let seen = "";
    await runFinalDecisionSynthesizer(ctx, input(), {
      configured: true,
      callModel: async (_system, user) => {
        if (!user.includes("Chart reading")) {
          return answer({
            browse: { verb: "read_zone", timeframe: "15m", low: 1.1, high: 1.12 },
          });
        }
        seen = user;
        return answer();
      },
      readCandles: async () => [
        // Traded in and closed back above: a rejection upward.
        { time: 1, open: 1.13, high: 1.14, low: 1.09, close: 1.13 },
        // Closed inside the band.
        { time: 2, open: 1.13, high: 1.13, low: 1.1, close: 1.11 },
        // Never came near it.
        { time: 3, open: 1.2, high: 1.22, low: 1.19, close: 1.21 },
      ],
    });
    assert.match(seen, /2 bar\(s\) traded into it/);
    assert.match(seen, /1 closed inside/);
    assert.match(seen, /1 rejection\(s\) upward/);
  });

  it("keeps the decision when the capture fails", async () => {
    let calls = 0;
    const out = await runFinalDecisionSynthesizer(ctx, input(), {
      configured: true,
      callModel: async () => {
        calls += 1;
        return answer({ browse: view("1h"), planType: "conditional" });
      },
      captureExtraFrame: async () => null,
    });
    assert.equal(calls, 1, "no image, no re-read");
    assert.equal(out.result?.planType, "conditional");
  });

  it("keeps the decision when the re-read fails to parse", async () => {
    let calls = 0;
    const out = await runFinalDecisionSynthesizer(ctx, input(), {
      configured: true,
      callModel: async () => {
        calls += 1;
        if (calls === 1) return answer({ browse: view("1h") });
        return "not json at all";
      },
      captureExtraFrame: async (tf) => ({ timeframe: tf, imageBase64: "CCCC" }),
    });
    assert.equal(calls, 2);
    // The round failed; the decision that preceded it survives untouched.
    assert.equal(out.result?.decision, "buy");
  });

  it("refuses a frame outside the browsable set", async () => {
    let calls = 0;
    let captures = 0;
    await runFinalDecisionSynthesizer(ctx, input(), {
      configured: true,
      callModel: async () => {
        calls += 1;
        return answer({ browse: view("3m") });
      },
      captureExtraFrame: async () => {
        captures += 1;
        return null;
      },
    });
    assert.equal(calls, 1);
    assert.equal(captures, 0, "an unbrowsable frame must not be captured");
  });

  it("refuses a frame that was already attached", async () => {
    let captures = 0;
    await runFinalDecisionSynthesizer(ctx, input([{ timeframe: "4h" }]), {
      configured: true,
      callModel: async () => answer({ browse: view("4h") }),
      captureExtraFrame: async () => {
        captures += 1;
        return null;
      },
    });
    assert.equal(captures, 0, "re-requesting a shown frame is refused, not re-captured");
  });

  it("refuses the same question twice — the answer would not change", async () => {
    let captures = 0;
    let calls = 0;
    await runFinalDecisionSynthesizer(ctx, input(), {
      configured: true,
      callModel: async () => {
        calls += 1;
        // Asks for the SAME candles every round. The first is served; a repeat
        // would spend budget to learn nothing.
        return answer({ browse: { verb: "read_candles", timeframe: "15m", count: 10 } });
      },
      captureExtraFrame: async () => {
        captures += 1;
        return null;
      },
      readCandles: async () => [{ time: 1, open: 1, high: 2, low: 0.5, close: 1.5 }],
    });
    assert.equal(calls, 2, "served once, then the repeat ends the loop");
    assert.equal(captures, 0);
  });

  it("stops at the call budget even when the model keeps asking", async () => {
    let calls = 0;
    let served = 0;
    await runFinalDecisionSynthesizer(ctx, input(), {
      configured: true,
      callModel: async () => {
        calls += 1;
        // A different question every round, so only the BUDGET can stop it.
        return answer({
          browse: { verb: "read_candles", timeframe: "15m", count: calls + 1 },
        });
      },
      readCandles: async () => {
        served += 1;
        return [{ time: served, open: 1, high: 2, low: 0.5, close: 1.5 }];
      },
    });
    assert.equal(served, MAX_BROWSE_CALLS, "exactly the budget, never more");
    assert.equal(calls, MAX_BROWSE_CALLS + 1, "one first call plus one re-read per round");
  });

  it("serves nothing when the dependency is absent", async () => {
    let calls = 0;
    const out = await runFinalDecisionSynthesizer(ctx, input(), {
      configured: true,
      callModel: async () => {
        calls += 1;
        return answer({ browse: { verb: "read_candles", timeframe: "15m", count: 5 } });
      },
      // No readCandles dep at all.
    });
    assert.equal(calls, 1, "an unservable request ends the loop, it does not retry");
    assert.equal(out.result?.decision, "buy", "and the decision still stands");
  });
});
