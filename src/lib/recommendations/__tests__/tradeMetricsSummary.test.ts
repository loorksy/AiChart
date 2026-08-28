/**
 * The outcome-summary projection the detail API and the cards share, and the
 * live in-trade helpers (R so far, progress toward the next target).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeTradeMetricsSummary,
  displayROf,
  liveRSoFar,
  progressTowardNextTarget,
} from "@/lib/recommendations/tradeMetricsSummary";
import type { TrackedRecommendation } from "@/lib/recommendations/types";

const M = 60_000;
const T0 = 1_700_000_000_000;

function rec(over: Partial<TrackedRecommendation> = {}): TrackedRecommendation {
  return {
    id: "r1",
    userId: 1,
    symbol: "XAUUSD",
    interval: "15m",
    direction: "buy",
    entryType: "limit_touch",
    entry: 100,
    stopLoss: 98,
    targets: [102, 104, 106],
    status: "pending_entry",
    outcome: "pending",
    createdAt: T0,
    createdCandleTime: T0,
    expiresAt: T0 + 100 * M,
    ...over,
  };
}

describe("computeTradeMetricsSummary", () => {
  it("reports the sweep's measurement verbatim on a terminal record", () => {
    const s = computeTradeMetricsSummary(
      rec({
        status: "sl_hit",
        outcome: "loss",
        triggeredAt: T0 + 2 * M,
        slHitAt: T0 + 9 * M,
        realizedR: -1.3,
        mfeR: 0.6,
        maeR: -1.3,
        exitPrice: 97.4,
        exitAt: T0 + 9 * M,
        exitReason: "stop",
        timeInTradeMs: 7 * M,
        stopBreachSurvivedCount: 1,
      }),
    );
    assert.equal(s.terminal, true);
    assert.equal(s.grade, "loss");
    assert.equal(s.realizedR, -1.3);
    assert.equal(s.mfeR, 0.6);
    assert.equal(s.maeR, -1.3);
    assert.equal(s.timeToActivationMs, 2 * M);
    assert.equal(s.timeInTradeMs, 7 * M);
    assert.equal(s.exitPrice, 97.4);
    assert.equal(s.stopBreachSurvivedCount, 1);
  });

  it("legacy terminal rows derive R from their levels and stay null elsewhere", () => {
    const s = computeTradeMetricsSummary(
      rec({
        status: "tp1_hit",
        outcome: "win_tp1",
        triggeredAt: T0 + M,
        tp1HitAt: T0 + 5 * M,
        slHitAt: T0 + 9 * M,
      }),
    );
    assert.equal(s.realizedR, 1); // (102-100)/2 from the plan's own levels
    assert.equal(s.mfeR, null); // never measured — never invented
    assert.equal(s.maeR, null);
  });

  it("a live position reports time in trade so far against the given clock", () => {
    const s = computeTradeMetricsSummary(
      rec({ status: "triggered", outcome: "pending", triggeredAt: T0 + M }),
      T0 + 31 * M,
    );
    assert.equal(s.terminal, false);
    assert.equal(s.grade, "active");
    assert.equal(s.realizedR, null); // nothing realized while the trade lives
    assert.equal(s.timeInTradeMs, 30 * M);
  });
});

describe("displayROf", () => {
  it("is the furthest banked target on a closed win and live R while open", () => {
    const closed = rec({
      status: "tp2_hit",
      outcome: "win_tp2",
      triggeredAt: T0,
      tp1HitAt: T0 + M,
      tp2HitAt: T0 + 2 * M,
    });
    assert.equal(displayROf(closed), 2);
    const live = rec({ status: "triggered", outcome: "pending", triggeredAt: T0 });
    assert.equal(displayROf(live, 101), 0.5);
    assert.equal(displayROf(live, 101), liveRSoFar(live, 101));
  });
});

describe("liveRSoFar", () => {
  const live = rec({ status: "triggered", outcome: "pending", triggeredAt: T0 });

  it("marks the position's current R from the effective entry", () => {
    assert.equal(liveRSoFar(live, 101), 0.5);
    assert.equal(liveRSoFar({ ...live, effectiveEntry: 101 }, 101), 0);
    assert.equal(liveRSoFar({ ...live, direction: "sell" }, 101), -0.5);
  });

  it("returns nothing without a fill or without a price", () => {
    assert.equal(liveRSoFar(rec(), 101), null);
    assert.equal(liveRSoFar(live, null), null);
    assert.equal(liveRSoFar({ ...live, outcome: "loss" }, 101), null);
  });
});

describe("progressTowardNextTarget", () => {
  const live = rec({ status: "triggered", outcome: "pending", triggeredAt: T0 });

  it("anchors entry → next target and clamps both ends", () => {
    const p = progressTowardNextTarget(live, 101)!;
    assert.equal(p.targetIndex, 1);
    assert.equal(p.target, 102);
    assert.equal(p.ratio, 0.5);
    assert.equal(progressTowardNextTarget(live, 97)!.ratio, 0); // drawdown ≠ backwards bar
    assert.equal(progressTowardNextTarget(live, 103)!.ratio, 1);
  });

  it("advances to the next untaken target once one is banked", () => {
    const p = progressTowardNextTarget({ ...live, tp1HitAt: T0 + M }, 103)!;
    assert.equal(p.targetIndex, 2);
    assert.equal(p.target, 104);
    assert.equal(p.ratio, 0.75); // (103-100)/(104-100)
  });

  it("returns nothing when unfilled, terminal, or all targets are taken", () => {
    assert.equal(progressTowardNextTarget(rec(), 101), null);
    assert.equal(
      progressTowardNextTarget(
        { ...live, tp1HitAt: T0, tp2HitAt: T0, tp3HitAt: T0 },
        101,
      ),
      null,
    );
  });
});
