import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  evaluateRecommendation,
  type EvaluateInput,
  type TrackerCandle,
} from "@/lib/recommendations/recommendationStatus";

const T = Date.UTC(2026, 0, 1, 12, 0, 0);
const MIN = 60_000;

function candle(i: number, o: number, h: number, l: number, c: number): TrackerCandle {
  return { time: T + i * MIN, open: o, high: h, low: l, close: c };
}

function rec(over: Partial<EvaluateInput["recommendation"]> = {}): EvaluateInput["recommendation"] {
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

describe("evaluateRecommendation", () => {
  it("stays pending when entry is never touched", () => {
    const r = evaluateRecommendation({
      recommendation: rec(),
      candles: [candle(1, 101, 101.5, 100.5, 101)],
      now: T + MIN,
    });
    assert.equal(r.status, "pending_entry");
    assert.equal(r.triggered, false);
    assert.equal(r.outcome, "pending");
  });

  it("buy entry triggers on low <= entry (after the creation candle)", () => {
    const r = evaluateRecommendation({
      recommendation: rec(),
      candles: [candle(1, 101, 101.2, 99.9, 100.5)],
      now: T + MIN,
    });
    assert.equal(r.triggered, true);
    assert.equal(r.status, "triggered");
  });

  it("sell entry triggers on high >= entry", () => {
    const r = evaluateRecommendation({
      recommendation: rec({ direction: "sell", entry: 100, stopLoss: 102, targets: [98, 96, 94] }),
      candles: [candle(1, 99, 100.1, 98.9, 99.5)],
      now: T + MIN,
    });
    assert.equal(r.triggered, true);
    assert.equal(r.status, "triggered");
  });

  it("does not count TP before entry is triggered — and closes the plan as missed", () => {
    // A candle spikes to TP1 but never touches the entry → no trigger, no TP
    // credited. The predicted move happened WITHOUT a fill, so the plan ends
    // as a missed opportunity (expired + missedWithoutFill) instead of
    // waiting forever for an entry the market already ran away from (the
    // XAUUSD conditional-sell incident).
    const r = evaluateRecommendation({
      recommendation: rec({ entry: 99 }),
      candles: [candle(1, 101, 103, 100, 102)],
      now: T + MIN,
    });
    assert.equal(r.triggered, false);
    assert.equal(r.tp1HitAt, undefined);
    assert.equal(r.status, "expired");
    assert.equal(r.missedWithoutFill, true);
    assert.equal(r.outcome, "expired");
  });

  it("stays pending when price moves toward TP1 but does not reach it", () => {
    // Same shape as above but the spike stops short of TP1 (102) → still a
    // live plan waiting for its entry, NOT a missed opportunity.
    const r = evaluateRecommendation({
      recommendation: rec({ entry: 99 }),
      candles: [candle(1, 101, 101.8, 100, 101.5)],
      now: T + MIN,
    });
    assert.equal(r.triggered, false);
    assert.equal(r.status, "pending_entry");
    assert.equal(r.missedWithoutFill ?? false, false);
  });

  it("ignores the creation candle", () => {
    // The creation candle (time == createdCandleTime) dips to entry+SL; ignored.
    const r = evaluateRecommendation({
      recommendation: rec({ createdCandleTime: T + MIN }),
      candles: [candle(1, 101, 101.2, 97.5, 98.2)],
      now: T + MIN,
    });
    assert.equal(r.triggered, false);
    assert.equal(r.status, "pending_entry");
  });

  it("updates TP1/TP2/TP3 after entry", () => {
    const r = evaluateRecommendation({
      recommendation: rec({ entryType: "market", status: "triggered", triggeredAt: T }),
      candles: [
        candle(1, 100, 102.1, 99.9, 101.5), // TP1
        candle(2, 101, 104.2, 101, 103.5), // TP2
        candle(3, 103, 106.1, 103, 105.5), // TP3 → terminal
      ],
      now: T + 3 * MIN,
    });
    assert.equal(r.status, "tp3_hit");
    assert.equal(r.outcome, "win_tp3");
    assert.ok(r.tp1HitAt && r.tp2HitAt && r.tp3HitAt);
  });

  it("marks SL loss when SL is hit before any TP", () => {
    const r = evaluateRecommendation({
      recommendation: rec({ entryType: "market", status: "triggered", triggeredAt: T }),
      candles: [candle(1, 100, 100.5, 97.5, 98)],
      now: T + MIN,
    });
    assert.equal(r.status, "sl_hit");
    assert.equal(r.outcome, "loss");
  });

  it("closes as a partial win when SL is hit after TP1", () => {
    const r = evaluateRecommendation({
      recommendation: rec({ entryType: "market", status: "triggered", triggeredAt: T }),
      candles: [
        candle(1, 100, 102.2, 99.9, 101.8), // TP1
        candle(2, 101, 101.5, 97.5, 98), // SL after TP1
      ],
      now: T + 2 * MIN,
    });
    assert.equal(r.outcome, "win_tp1");
    assert.equal(r.status, "tp1_hit");
  });

  it("resolves same-candle SL + TP conservatively (SL-first with no prior TP)", () => {
    const r = evaluateRecommendation({
      recommendation: rec({ entryType: "market", status: "triggered", triggeredAt: T }),
      candles: [candle(1, 100, 102.5, 97.5, 100)], // hits both TP1 and SL
      now: T + MIN,
    });
    assert.equal(r.ambiguous, true);
    assert.equal(r.outcome, "loss");
    assert.equal(r.status, "sl_hit");
  });

  it("expires an untriggered recommendation past its deadline", () => {
    const r = evaluateRecommendation({
      recommendation: rec({ expiresAt: T }),
      candles: [candle(1, 101, 101.5, 100.5, 101)],
      now: T + MIN,
    });
    assert.equal(r.status, "expired");
    assert.equal(r.outcome, "expired");
  });

  it("does not re-evaluate a terminal recommendation", () => {
    const r = evaluateRecommendation({
      recommendation: rec({ status: "cancelled", outcome: "cancelled" }),
      candles: [candle(1, 100, 106, 97, 105)],
      now: T + MIN,
    });
    assert.equal(r.status, "cancelled");
    assert.equal(r.outcome, "cancelled");
    assert.equal(r.changed, false);
  });
});

describe("the weekend sweep, with creation-anchored expiry", () => {
  // Jan 1 2026 is a Thursday; Jan 3 12:00 UTC is a Saturday tick with the
  // market closed and no new candles. The sweeps are deliberately UNCHANGED —
  // the weekend fix lives at creation (recommendationClockAnchor), so these
  // pin the division of labour: an anchored plan survives the weekend, a
  // Friday-expired plan does not.
  const SATURDAY = Date.UTC(2026, 0, 3, 12, 0, 0);

  it("does not expire a plan whose anchored deadline is beyond the weekend", () => {
    // Created Friday, clock anchored at Monday's open + validity.
    const mondayOpenPlusValidity = Date.UTC(2026, 0, 4, 23, 0, 0) + 3 * 60 * 60_000;
    const r = evaluateRecommendation({
      recommendation: rec({ expiresAt: mondayOpenPlusValidity }),
      candles: [],
      now: SATURDAY,
    });
    assert.equal(r.status, "pending_entry");
    assert.equal(r.outcome, "pending");
  });

  it("still expires a plan whose clock genuinely ran out on Friday", () => {
    const fridayDeadline = Date.UTC(2026, 0, 2, 15, 0, 0);
    const r = evaluateRecommendation({
      recommendation: rec({ expiresAt: fridayDeadline }),
      candles: [],
      now: SATURDAY,
    });
    assert.equal(r.status, "expired");
    assert.equal(r.outcome, "expired");
  });
});

describe("target zone — 10–15 points counts as touching every TP", () => {
  const GOLD_TOL = 10;
  const ENTRY = 4607.59;
  const SL = 4616.36;
  const TP1 = 4591.48;
  const TP2 = 4570;
  const TP3 = 4550;

  function goldSell(over: Partial<EvaluateInput["recommendation"]> = {}): EvaluateInput["recommendation"] {
    return rec({
      direction: "sell",
      entryType: "market",
      entry: ENTRY,
      stopLoss: SL,
      targets: [TP1, TP2, TP3],
      status: "triggered",
      triggeredAt: T,
      invalidationMode: "touch",
      ...over,
    });
  }

  it("screenshot: sell TP1 4591.48, candle low 4596.15 → tp1_hit at the honest 4596.15", () => {
    const r = evaluateRecommendation({
      recommendation: goldSell(),
      candles: [candle(1, 4600, 4602, 4596.15, 4596.15)],
      targetTolerance: GOLD_TOL,
      now: T + MIN,
    });
    assert.equal(r.status, "tp1_hit");
    assert.ok(r.tp1HitAt, "TP1 must be timestamped");
    assert.equal(r.tp2HitAt, undefined, "TP2 is still below this print");
    assert.equal(r.tp1HitPrice, 4596.15, "never claim the labeled 4591.48 — it was not printed");
  });

  it("buy mirror: high 10 pts below TP1 hits; 20 pts below does not", () => {
    const buy = rec({
      direction: "buy",
      entryType: "market",
      entry: 2620,
      stopLoss: 2600,
      targets: [2650, 2670, 2690],
      status: "triggered",
      triggeredAt: T,
    });
    const hit = evaluateRecommendation({
      recommendation: buy,
      candles: [candle(1, 2635, 2640, 2634, 2638)],
      targetTolerance: GOLD_TOL,
      now: T + MIN,
    });
    assert.equal(hit.status, "tp1_hit");
    assert.equal(hit.tp1HitPrice, 2640);

    const miss = evaluateRecommendation({
      recommendation: buy,
      candles: [candle(1, 2628, 2630, 2625, 2629)],
      targetTolerance: GOLD_TOL,
      now: T + MIN,
    });
    assert.equal(miss.status, "triggered");
    assert.equal(miss.tp1HitAt, undefined);
  });

  it("sell 20 pts above TP1 is NOT a hit", () => {
    const r = evaluateRecommendation({
      recommendation: goldSell(),
      candles: [candle(1, 4612, 4614, 4611.48, 4612)],
      targetTolerance: GOLD_TOL,
      now: T + MIN,
    });
    assert.equal(r.status, "triggered");
    assert.equal(r.tp1HitAt, undefined);
  });

  it("an exact touch still hits, at the labeled TP", () => {
    const r = evaluateRecommendation({
      recommendation: goldSell(),
      candles: [candle(1, 4595, 4596, 4591.48, 4592)],
      targetTolerance: GOLD_TOL,
      now: T + MIN,
    });
    assert.equal(r.status, "tp1_hit");
    assert.equal(r.tp1HitPrice, TP1);
  });

  it("TP2 is not hit until TP1's zone is hit; TP2 then needs its own zone", () => {
    const first = evaluateRecommendation({
      recommendation: goldSell(),
      candles: [candle(1, 4600, 4602, 4596.15, 4596.15)],
      targetTolerance: GOLD_TOL,
      now: T + MIN,
    });
    assert.equal(first.status, "tp1_hit");
    assert.equal(first.tp2HitAt, undefined);

    const second = evaluateRecommendation({
      recommendation: goldSell({
        status: "tp1_hit",
        tp1HitAt: T + MIN,
        tp1HitPrice: 4596.15,
      }),
      candles: [
        candle(1, 4600, 4602, 4596.15, 4596.15),
        candle(2, 4596, 4597, 4575, 4576),
      ],
      targetTolerance: GOLD_TOL,
      now: T + 2 * MIN,
    });
    assert.equal(second.status, "tp2_hit");
    assert.ok(second.tp1HitAt);
    assert.ok(second.tp2HitAt);
    assert.equal(second.tp3HitAt, undefined, "TP3 4550+10=4560; low 4575 is still outside");
  });

  it("the stop is NOT hit merely by being 10 pts away", () => {
    const r = evaluateRecommendation({
      recommendation: goldSell(),
      candles: [candle(1, 4608, 4606.36, 4605, 4605.5)],
      targetTolerance: GOLD_TOL,
      now: T + MIN,
    });
    assert.equal(r.status, "triggered", "high 4606.36 is 10 pts below SL 4616.36 — not a stop");
    assert.equal(r.slHitAt, undefined);
    assert.equal(r.tp1HitAt, undefined);
  });

  it("touch-mode invalidation still dies on an exact wick through the stop", () => {
    const r = evaluateRecommendation({
      recommendation: goldSell({ invalidationMode: "touch" }),
      candles: [candle(1, 4608, 4616.36, 4605, 4608)],
      targetTolerance: GOLD_TOL,
      now: T + MIN,
    });
    assert.equal(r.status, "sl_hit");
    assert.equal(r.outcome, "loss");
  });

  it("close-mode invalidation still requires a CLOSE beyond the stop, not a wick", () => {
    const wick = evaluateRecommendation({
      recommendation: goldSell({ invalidationMode: "close", planType: "conditional" }),
      candles: [candle(1, 4608, 4620, 4605, 4610)],
      targetTolerance: GOLD_TOL,
      now: T + MIN,
    });
    assert.equal(wick.status, "triggered", "wick through 4616.36 with close 4610 is a rejection");
    assert.equal(wick.slHitAt, undefined);

    const closed = evaluateRecommendation({
      recommendation: goldSell({ invalidationMode: "close", planType: "conditional" }),
      candles: [candle(1, 4608, 4620, 4605, 4617)],
      targetTolerance: GOLD_TOL,
      now: T + MIN,
    });
    assert.equal(closed.status, "sl_hit");
    assert.equal(closed.outcome, "loss");
  });

  it("only TP1 exists → terminal win_tp1 once the zone is reached", () => {
    const r = evaluateRecommendation({
      recommendation: goldSell({ targets: [TP1] }),
      candles: [candle(1, 4600, 4602, 4596.15, 4596.15)],
      targetTolerance: GOLD_TOL,
      now: T + MIN,
    });
    assert.equal(r.status, "tp1_hit");
    assert.equal(r.outcome, "win_tp1");
    assert.equal(r.tp1HitPrice, 4596.15);
  });

  it("omitted tolerance keeps exact-touch grading (replay pins)", () => {
    const r = evaluateRecommendation({
      recommendation: goldSell(),
      candles: [candle(1, 4600, 4602, 4596.15, 4596.15)],
      now: T + MIN,
    });
    assert.equal(r.status, "triggered");
    assert.equal(r.tp1HitAt, undefined);
  });
});
