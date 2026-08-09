import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  evaluateRecommendation,
  type EvaluateInput,
  type TrackerCandle,
} from "@/lib/recommendations/recommendationStatus";
import type { ActivationRule } from "@/lib/recommendations/activationRule";

/**
 * High #4, at the level the finding was actually reported: the TRACKER.
 *
 * `activationRule.test.ts` proves the rules grade correctly in isolation. These
 * prove the tracker consults them — that a plan whose condition demands a close
 * no longer fills on the wick that merely grazed its entry. Every "does not
 * trigger" case below triggers on the pre-fix code.
 */

const T = Date.UTC(2026, 0, 1, 12, 0, 0);
const MIN = 60_000;

function candle(i: number, o: number, h: number, l: number, c: number): TrackerCandle {
  return { time: T + i * MIN, open: o, high: h, low: l, close: c };
}

function rec(
  over: Partial<EvaluateInput["recommendation"]> = {},
): EvaluateInput["recommendation"] {
  return {
    direction: "buy",
    entryType: "limit",
    entry: 100,
    stopLoss: 98,
    targets: [102, 104, 106],
    status: "pending_entry",
    outcome: "pending",
    createdAt: T,
    createdCandleTime: T,
    expiresAt: T + 10 * 60 * MIN,
    ...over,
  };
}

/** "Buy the retest, but only once an hourly candle closes back above 100." */
const CLOSE_ABOVE_100: ActivationRule = {
  kind: "candle_close_above",
  level: 100,
  timeframe: "1h",
};

describe("a plan with no activation rule keeps touch semantics", () => {
  it("triggers on a bare touch, exactly as before", () => {
    const result = evaluateRecommendation({
      recommendation: rec(),
      candles: [candle(1, 101, 101.2, 99.9, 100.5)],
      now: T + MIN,
    });
    assert.equal(result.triggered, true);
  });
});

describe("a plan whose rule demands a close", () => {
  it("does NOT trigger on a wick that touches entry but closes below the level", () => {
    // The finding in one case. low 99.9 touches the 100 entry; close 99.4 does
    // not satisfy "close above 100". Pre-fix this filled.
    const result = evaluateRecommendation({
      recommendation: rec({ activationRule: CLOSE_ABOVE_100 }),
      candles: [candle(1, 99.8, 100.2, 99.9, 99.4)],
      now: T + MIN,
    });
    assert.equal(result.triggered, false);
    assert.equal(result.status, "pending_entry");
    assert.equal(result.activationEvidence, undefined);
  });

  it("triggers once a candle closes above the level and reaches entry", () => {
    const result = evaluateRecommendation({
      recommendation: rec({ activationRule: CLOSE_ABOVE_100 }),
      candles: [candle(1, 99.8, 101, 99.9, 100.6)],
      now: T + MIN,
    });
    assert.equal(result.triggered, true);
    assert.equal(result.status, "triggered");
    assert.equal(result.activationEvidence?.kind, "candle_close_above");
    assert.equal(result.activationEvidence?.at, T + MIN);
  });

  it("stays armed: the condition met on an earlier candle still counts later", () => {
    // Condition satisfied on candle 1 while price is above entry; the fill comes
    // on candle 2 when price returns to the entry.
    const result = evaluateRecommendation({
      recommendation: rec({ activationRule: CLOSE_ABOVE_100 }),
      candles: [
        candle(1, 100.6, 101.5, 100.4, 101.2),
        candle(2, 101.2, 101.3, 99.7, 100.1),
      ],
      now: T + 2 * MIN,
    });
    assert.equal(result.triggered, true);
    assert.equal(result.triggeredAt, T + 2 * MIN);
    // The evidence names the candle that satisfied the CONDITION, not the fill.
    assert.equal(result.activationEvidence?.at, T + MIN);
  });
});

describe("a retest plan is not filled by the breakout", () => {
  const retest: ActivationRule = {
    kind: "retest_confirmed",
    level: 100,
    direction: "above",
    retestZone: { low: 99.6, high: 100.4 },
    timeframe: "1h",
  };

  it("does not trigger when price breaks out and runs away", () => {
    const result = evaluateRecommendation({
      recommendation: rec({ activationRule: retest }),
      candles: [
        candle(1, 99.5, 101, 99.4, 100.8), // the break — and it touches entry
        candle(2, 100.8, 103, 100.7, 102.8), // gone, never retested
      ],
      now: T + 2 * MIN,
    });
    assert.equal(result.triggered, false);
  });

  it("triggers on break, return, confirmation — then the entry fill", () => {
    const result = evaluateRecommendation({
      recommendation: rec({ activationRule: retest }),
      candles: [
        candle(1, 99.5, 101, 99.4, 100.8), // break
        candle(2, 100.8, 100.9, 99.8, 100.2), // return into the zone
        candle(3, 100.2, 101.5, 99.95, 101.1), // confirm + touch entry
      ],
      now: T + 3 * MIN,
    });
    assert.equal(result.triggered, true);
    assert.equal(result.activationEvidence?.kind, "retest_confirmed");
  });
});

describe("expiry and terminal state beat activation", () => {
  it("an expired rule never activates the plan", () => {
    const result = evaluateRecommendation({
      recommendation: rec({
        activationRule: { ...CLOSE_ABOVE_100, expiresAt: T },
      }),
      candles: [candle(1, 99.8, 101, 99.9, 100.6)],
      now: T + MIN,
    });
    assert.equal(result.triggered, false);
  });

  it("a plan past its candle validity expires instead of activating", () => {
    const result = evaluateRecommendation({
      recommendation: rec({ activationRule: CLOSE_ABOVE_100, validityCandles: 1 }),
      candles: [
        candle(1, 99.8, 99.9, 99.5, 99.6), // condition not met
        candle(2, 99.6, 101, 99.9, 100.6), // would qualify, but the budget is spent
      ],
      now: T + 2 * MIN,
    });
    assert.equal(result.status, "expired");
    assert.equal(result.triggered, false);
  });

  it("a terminal record is never re-activated", () => {
    const result = evaluateRecommendation({
      recommendation: rec({
        activationRule: CLOSE_ABOVE_100,
        status: "sl_hit",
        outcome: "loss",
      }),
      candles: [candle(1, 99.8, 101, 99.9, 100.6)],
      now: T + MIN,
    });
    assert.equal(result.outcome, "loss");
    assert.equal(result.changed, false);
  });
});

describe("activation is decided once", () => {
  it("re-evaluating an already-triggered plan does not re-derive activation", () => {
    const result = evaluateRecommendation({
      recommendation: rec({
        activationRule: CLOSE_ABOVE_100,
        triggeredAt: T + MIN,
      }),
      candles: [candle(2, 100.5, 101, 100.2, 100.9)],
      now: T + 2 * MIN,
    });
    assert.equal(result.triggered, true);
    assert.equal(result.triggeredAt, T + MIN);
    // No new activation evidence: the plan activated once, on an earlier pass.
    assert.equal(result.activationEvidence, undefined);
  });
});
