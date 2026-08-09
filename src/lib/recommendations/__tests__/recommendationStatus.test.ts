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
