/**
 * The post-fill measurement module: MFE/MAE in R, realized R of the actual
 * exit, durations, stop-breach survivals, the monotone merge, and the grade
 * taxonomy. Candle-series replays — the same evidence the evaluator walks.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeTradeMetrics,
  formatSignedR,
  gradeRecommendation,
  mergeTradeMetrics,
  realizedROf,
  TERMINAL_GRADES,
  type TradeMetricsInput,
} from "@/lib/recommendations/tradeMetrics";
import type { TrackerCandle } from "@/lib/recommendations/recommendationStatus";
import type { TrackedRecommendationOutcome } from "@/lib/recommendations/types";

const M = 60_000;
const T0 = 1_700_000_000_000;

function candle(
  i: number,
  open: number,
  high: number,
  low: number,
  close: number,
): TrackerCandle {
  return { time: T0 + i * M, open, high, low, close };
}

/** A buy plan: entry 100, stop 98 (risk 2), targets 102 / 104 / 106. */
function input(
  outcome: TrackedRecommendationOutcome,
  candles: TrackerCandle[],
  over: Partial<TradeMetricsInput["recommendation"]> = {},
): TradeMetricsInput {
  return {
    recommendation: {
      direction: "buy",
      entryType: "limit_touch",
      entry: 100,
      stopLoss: 98,
      invalidationMode: "touch",
      targets: [102, 104, 106],
      outcome,
      createdAt: T0 - 5 * M,
      expiresAt: T0 + 100 * M,
      triggeredAt: T0,
      ...over,
    },
    candles,
    now: T0 + 50 * M,
  };
}

describe("computeTradeMetrics", () => {
  it("measures nothing for an unfilled plan — only the clock exists", () => {
    const m = computeTradeMetrics(
      input("expired", [candle(0, 100, 103, 99, 102)], { triggeredAt: null }),
    );
    assert.equal(m.mfeR, null);
    assert.equal(m.maeR, null);
    assert.equal(m.realizedR, null);
    assert.equal(m.timeToActivationMs, null);
    assert.equal(m.timeInTradeMs, null);
  });

  it("partial win (TP1 then stop): record closes at the banked target, MFE keeps the real peak", () => {
    const candles = [
      candle(0, 100, 100.5, 99.5, 100.2), // fill candle
      candle(1, 100.2, 103, 100, 102.5), // TP1 (102) hit, peaked at 103
      candle(2, 102.5, 102.6, 97.9, 98), // stop (98) swept the remainder
    ];
    const m = computeTradeMetrics(
      input("win_tp1", candles, {
        tp1HitAt: T0 + 1 * M,
        slHitAt: T0 + 2 * M,
      }),
    );
    assert.equal(m.exitReason, "stop_after_target");
    assert.equal(m.exitPrice, 102); // the banked target, the evaluator's own policy
    assert.equal(m.exitAt, T0 + 2 * M);
    assert.equal(m.realizedR, 1); // (102-100)/2
    assert.equal(m.mfeR, 1.5); // peak 103 → (103-100)/2
    // Touch mode: adverse excursion can never exceed the stop.
    assert.equal(m.maeR, -1);
    assert.equal(m.timeToActivationMs, 5 * M);
    assert.equal(m.timeInTradeMs, 2 * M);
  });

  it("zone-only TP1 exit uses the honest print, not the labeled line", () => {
    const candles = [
      candle(0, 4607.59, 4609, 4606, 4607),
      candle(1, 4607, 4608, 4596.15, 4597),
      candle(2, 4597, 4598, 4616.4, 4616.5),
    ];
    const m = computeTradeMetrics({
      recommendation: {
        direction: "sell",
        entryType: "market",
        entry: 4607.59,
        stopLoss: 4616.36,
        invalidationMode: "touch",
        targets: [4591.48, 4570],
        outcome: "win_tp1",
        createdAt: T0 - 5 * M,
        expiresAt: T0 + 100 * M,
        triggeredAt: T0,
        tp1HitAt: T0 + 1 * M,
        tp1HitPrice: 4596.15,
        slHitAt: T0 + 2 * M,
      },
      candles,
      now: T0 + 50 * M,
    });
    assert.equal(m.exitReason, "stop_after_target");
    assert.equal(m.exitPrice, 4596.15);
    assert.equal(m.realizedR, 1.3);
  });

  it("full win at TP3 caps the favorable excursion at the exit", () => {
    const candles = [
      candle(0, 100, 101, 99.8, 100.5),
      candle(1, 100.5, 108, 100.4, 107), // ran through TP3 (106) to 108
    ];
    const m = computeTradeMetrics(
      input("win_tp3", candles, {
        tp1HitAt: T0 + 1 * M,
        tp2HitAt: T0 + 1 * M,
        tp3HitAt: T0 + 1 * M,
      }),
    );
    assert.equal(m.exitReason, "target");
    assert.equal(m.exitPrice, 106);
    assert.equal(m.realizedR, 3);
    // Price beyond the target happened after the position closed.
    assert.equal(m.mfeR, 3);
  });

  it("touch-mode loss exits AT the stop for exactly -1R", () => {
    const candles = [
      candle(0, 100, 100.5, 99.5, 100.2),
      candle(1, 100.2, 100.4, 97.5, 97.8), // traded through the stop
    ];
    const m = computeTradeMetrics(input("loss", candles, { slHitAt: T0 + 1 * M }));
    assert.equal(m.exitReason, "stop");
    assert.equal(m.exitPrice, 98);
    assert.equal(m.realizedR, -1);
    assert.equal(m.maeR, -1); // capped: the position could not survive past it
  });

  it("close-mode loss exits at the confirming CLOSE — honestly worse than -1R", () => {
    const candles = [
      candle(0, 100, 100.5, 99.5, 100.2),
      candle(1, 100.2, 100.4, 97.0, 97.4), // closed beyond the stop
    ];
    const m = computeTradeMetrics(
      input("loss", candles, {
        invalidationMode: "close",
        slHitAt: T0 + 1 * M,
      }),
    );
    assert.equal(m.exitPrice, 97.4);
    assert.equal(m.realizedR, -1.3); // (97.4-100)/2
    assert.ok((m.maeR ?? 0) < -1, "close mode records the real drawdown");
  });

  it("counts close-mode stop breaches the position survived", () => {
    const candles = [
      candle(0, 100, 100.5, 99.5, 100.2),
      candle(1, 100.2, 100.4, 97.5, 98.6), // wick through 98, closed back inside
      candle(2, 98.6, 99.5, 97.8, 98.4), // again
      candle(3, 98.4, 102.3, 98.3, 102.1), // TP1
    ];
    const m = computeTradeMetrics(
      input("win_tp1", candles, {
        invalidationMode: "close",
        tp1HitAt: T0 + 3 * M,
      }),
    );
    assert.equal(m.stopBreachSurvivedCount, 2);
    assert.equal(m.lastStopBreachSurvivedAt, T0 + 2 * M);
    // Survived drawdown is recorded, not hidden: low 97.5 → (97.5-100)/2.
    assert.equal(m.maeR, -1.25);
  });

  it("a confirmation_close fill candle contributes only its close — the wick predates the position", () => {
    const candles = [
      candle(0, 99, 103, 96, 100.4), // fill candle: wild wick both ways
      candle(1, 100.4, 101, 100, 100.8),
    ];
    const m = computeTradeMetrics(
      input("pending", candles, {
        entryType: "confirmation_close",
        effectiveEntry: 100.4,
        invalidationMode: "close",
      }),
    );
    // Neither the 103 high nor the 96 low of the fill candle counts.
    assert.equal(m.mfeR, 0.25); // (101 - 100.4) / 2.4
    assert.equal(m.maeR, -0.17); // (100 - 100.4) / 2.4
  });

  it("expiry while in trade exits at the last close before expiry", () => {
    const candles = [
      candle(0, 100, 100.5, 99.5, 100.2),
      candle(1, 100.2, 101.5, 100, 101),
    ];
    const m = computeTradeMetrics(
      input("expired", candles, { expiredAt: T0 + 2 * M }),
    );
    assert.equal(m.exitReason, "expiry");
    assert.equal(m.exitPrice, 101);
    assert.equal(m.realizedR, 0.5);
  });
});

describe("mergeTradeMetrics", () => {
  it("keeps the larger excursion an earlier sweep already observed", () => {
    const next = computeTradeMetrics(
      input("pending", [candle(0, 100, 100.6, 99.9, 100.4)]),
    );
    const merged = mergeTradeMetrics(
      { mfeR: 1.4, mfePrice: 102.8, maeR: -0.9, maePrice: 98.2 },
      next,
    );
    assert.equal(merged.mfeR, 1.4);
    assert.equal(merged.mfePrice, 102.8);
    assert.equal(merged.maeR, -0.9);
    assert.equal(merged.maePrice, 98.2);
  });

  it("keeps a persisted terminal exit when the exit candle aged out of the window", () => {
    const next = computeTradeMetrics(input("loss", [], { slHitAt: null }));
    const merged = mergeTradeMetrics(
      {
        exitAt: T0 + 9 * M,
        exitPrice: 98,
        exitReason: "stop",
        realizedR: -1,
        timeInTradeMs: 9 * M,
      },
      next,
    );
    assert.equal(merged.exitAt, T0 + 9 * M);
    assert.equal(merged.exitPrice, 98);
    assert.equal(merged.exitReason, "stop");
    assert.equal(merged.realizedR, -1);
    assert.equal(merged.timeInTradeMs, 9 * M);
  });

  it("takes the maximum stop-breach count and the newest breach time", () => {
    const next = computeTradeMetrics(
      input("pending", [candle(0, 100, 100.6, 99.9, 100.4)]),
    );
    const merged = mergeTradeMetrics(
      { stopBreachSurvivedCount: 3, lastStopBreachSurvivedAt: T0 - M },
      next,
    );
    assert.equal(merged.stopBreachSurvivedCount, 3);
    assert.equal(merged.lastStopBreachSurvivedAt, T0 - M);
  });
});

describe("gradeRecommendation", () => {
  it("distinguishes every terminal fate the record can reach", () => {
    assert.equal(gradeRecommendation({ outcome: "win_tp3", triggeredAt: T0 }), "win_tp3");
    assert.equal(gradeRecommendation({ outcome: "win_tp1", triggeredAt: T0 }), "win_tp1");
    assert.equal(gradeRecommendation({ outcome: "loss", triggeredAt: T0 }), "loss");
    assert.equal(
      gradeRecommendation({ outcome: "expired", triggeredAt: T0, realizedR: 0.4 }),
      "expired_in_profit",
    );
    assert.equal(
      gradeRecommendation({ outcome: "expired", triggeredAt: T0, realizedR: -0.4 }),
      "expired_in_loss",
    );
    assert.equal(
      gradeRecommendation({ outcome: "expired", triggeredAt: T0, realizedR: null }),
      "expired_in_trade",
    );
    assert.equal(
      gradeRecommendation({ outcome: "expired", missedWithoutFill: true }),
      "missed_opportunity",
    );
    assert.equal(gradeRecommendation({ outcome: "expired" }), "expired_untriggered");
    assert.equal(
      gradeRecommendation({ outcome: "invalidated" }),
      "invalidated_before_entry",
    );
    assert.equal(
      gradeRecommendation({ outcome: "invalidated", triggeredAt: T0 }),
      "invalidated_in_trade",
    );
    assert.equal(
      gradeRecommendation({ outcome: "cancelled", supersededAt: T0 }),
      "superseded",
    );
    assert.equal(gradeRecommendation({ outcome: "cancelled" }), "cancelled");
    assert.equal(gradeRecommendation({ outcome: "pending", triggeredAt: T0 }), "active");
    assert.equal(gradeRecommendation({ outcome: "pending" }), "pending_entry");
  });

  it("every terminal grade is reachable and listed exactly once", () => {
    assert.equal(new Set(TERMINAL_GRADES).size, TERMINAL_GRADES.length);
    assert.ok(!TERMINAL_GRADES.includes("active"));
    assert.ok(!TERMINAL_GRADES.includes("pending_entry"));
  });
});

describe("realizedROf — legacy derivation", () => {
  const base = {
    entry: 100,
    stopLoss: 98,
    targets: [102, 104, 106],
  };

  it("prefers the sweep's persisted measurement", () => {
    assert.equal(
      realizedROf({ ...base, outcome: "loss", realizedR: -1.3 }),
      -1.3,
    );
  });

  it("derives a win from the banked target and a loss as -1R", () => {
    assert.equal(realizedROf({ ...base, outcome: "win_tp2" }), 2);
    assert.equal(realizedROf({ ...base, outcome: "loss" }), -1);
  });

  it("grades from the effective entry when one is persisted", () => {
    assert.equal(
      realizedROf({ ...base, effectiveEntry: 101, outcome: "win_tp1" }),
      0.33, // (102-101)/3
    );
  });

  it("refuses to invent an R for unmeasured expiries", () => {
    assert.equal(realizedROf({ ...base, outcome: "expired" }), null);
    assert.equal(realizedROf({ ...base, outcome: "cancelled" }), null);
  });

  it("a zone-only TP1 banks the honest print, not the labeled line", () => {
    assert.equal(
      realizedROf({
        direction: "sell",
        entry: 4607.59,
        stopLoss: 4616.36,
        targets: [4591.48],
        outcome: "win_tp1",
        tp1HitPrice: 4596.15,
      }),
      1.3, // (4607.59-4596.15)/|4607.59-4616.36| = 11.44/8.77 ≈ 1.304 → 1.30
    );
  });

  it("TP2 hit grades TP2's R even when a stale TP1 measurement is persisted", () => {
    assert.equal(
      realizedROf({
        direction: "sell",
        entry: 4601.99,
        stopLoss: 4605.2,
        targets: [4583.76, 4569.29],
        outcome: "win_tp2",
        tp1HitPrice: 4583.76,
        tp2HitPrice: 4578.42,
        realizedR: 5.68,
      }),
      7.34, // (4601.99-4578.42)/(4605.2-4601.99) = 23.57/3.21
    );
  });

  it("TP1-only is the TP1 R (~5.7) and TP2 labeled is ~10.2", () => {
    const base = {
      direction: "sell" as const,
      entry: 4601.99,
      stopLoss: 4605.2,
      targets: [4583.76, 4569.29],
    };
    assert.equal(realizedROf({ ...base, outcome: "win_tp1", tp1HitPrice: 4583.76 }), 5.68);
    assert.equal(realizedROf({ ...base, outcome: "win_tp2", tp2HitPrice: 4569.29 }), 10.19);
  });
});

describe("formatSignedR", () => {
  it("prints the report's trade-result face: +5.7R / -1.0R", () => {
    assert.equal(formatSignedR(5.68), "+5.7R");
    assert.equal(formatSignedR(10.19), "+10.2R");
    assert.equal(formatSignedR(-1), "-1.0R");
    assert.equal(formatSignedR(0), "0.0R");
    assert.equal(formatSignedR(null), null);
    assert.doesNotMatch(formatSignedR(5.68) ?? "", /[\u0660-\u0669]/);
    assert.doesNotMatch(formatSignedR(5.68) ?? "", /%/);
  });
});
