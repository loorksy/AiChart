import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeRecommendationStats,
  filterByPeriod,
} from "@/lib/recommendations/recommendationStats";
import type {
  TrackedRecommendation,
  TrackedRecommendationOutcome,
  TrackedRecommendationStatus,
} from "@/lib/recommendations/types";

let seq = 0;
function rec(
  outcome: TrackedRecommendationOutcome,
  over: Partial<TrackedRecommendation> = {},
): TrackedRecommendation {
  const triggered = outcome !== "pending" && outcome !== "expired" && outcome !== "cancelled";
  const statusByOutcome: Record<TrackedRecommendationOutcome, TrackedRecommendationStatus> = {
    pending: "triggered",
    win_tp1: "tp1_hit",
    win_tp2: "tp2_hit",
    win_tp3: "tp3_hit",
    loss: "sl_hit",
    expired: "expired",
    cancelled: "cancelled",
    invalidated: "invalidated",
  };
  return {
    id: `r${seq++}`,
    userId: 1,
    symbol: "XAUUSD",
    interval: "15m",
    direction: "buy",
    entryType: "market",
    entry: 100,
    stopLoss: 98,
    targets: [102, 104, 106],
    status: statusByOutcome[outcome],
    outcome,
    createdAt: Date.now(),
    createdCandleTime: Date.now(),
    expiresAt: Date.now() + 1000,
    triggeredAt: over.triggeredAt ?? (triggered ? Date.now() : undefined),
    rr: 2,
    ...over,
  };
}

describe("computeRecommendationStats", () => {
  it("win rate excludes pending and untriggered", () => {
    const stats = computeRecommendationStats([
      rec("win_tp1"),
      rec("win_tp3"),
      rec("loss"),
      rec("pending", { triggeredAt: Date.now() }), // active (triggered), excluded
      rec("pending", { triggeredAt: undefined }), // pending entry, excluded
      rec("expired", { triggeredAt: undefined }), // untriggered expired, excluded from win rate
    ]);
    assert.equal(stats.wins, 2);
    assert.equal(stats.losses, 1);
    assert.equal(stats.completedTriggered, 3);
    // Sample below WIN_RATE_SAMPLE_FLOOR — percentage suppressed.
    assert.equal(stats.winRate, null);
    assert.equal(stats.active, 1);
    assert.equal(stats.pending, 1);
  });

  it("untriggered expired is not counted as a loss", () => {
    const stats = computeRecommendationStats([rec("expired", { triggeredAt: undefined })]);
    assert.equal(stats.losses, 0);
    assert.equal(stats.wins, 0);
    assert.equal(stats.winRate, null);
    assert.equal(stats.breakdown.untriggeredExpired, 1);
    assert.equal(stats.breakdown.expired, 1);
    assert.equal(stats.expiredUnactivatedRate, 1);
  });

  it("suppresses win-rate percentage below the sample-size floor", () => {
    const sevenWins = Array.from({ length: 7 }, () => rec("win_tp1"));
    const below = computeRecommendationStats(sevenWins);
    assert.equal(below.completedTriggered, 7);
    assert.equal(below.winRate, null);

    const eight = computeRecommendationStats([...sevenWins, rec("loss")]);
    assert.equal(eight.completedTriggered, 8);
    assert.equal(eight.winRate, 88); // 7/8
  });

  it("produces the TP1/TP2/TP3 breakdown", () => {
    const stats = computeRecommendationStats([
      rec("win_tp1"),
      rec("win_tp1"),
      rec("win_tp2"),
      rec("win_tp3"),
      rec("loss"),
      rec("invalidated"),
    ]);
    assert.equal(stats.breakdown.win_tp1, 2);
    assert.equal(stats.breakdown.win_tp2, 1);
    assert.equal(stats.breakdown.win_tp3, 1);
    assert.equal(stats.breakdown.loss, 1);
    assert.equal(stats.breakdown.invalidated, 1);
  });

  it("groups by symbol, timeframe, and setup type", () => {
    const stats = computeRecommendationStats([
      rec("win_tp1", { symbol: "XAUUSD", interval: "15m", setupType: "scalp" }),
      rec("loss", { symbol: "XAUUSD", interval: "1h", setupType: "trend" }),
      rec("win_tp3", { symbol: "EURUSD", interval: "15m", setupType: "scalp" }),
    ]);
    assert.equal(stats.bySymbol.find((g) => g.key === "XAUUSD")?.total, 2);
    assert.equal(stats.byTimeframe.find((g) => g.key === "15m")?.total, 2);
    assert.equal(stats.bySetupType.find((g) => g.key === "scalp")?.total, 2);
    assert.equal(stats.scalp.total, 2);
    assert.equal(stats.scalp.wins, 2);
  });

  it("filters by period", () => {
    const DAY = 86_400_000;
    const now = Date.now();
    const recs = [
      rec("win_tp1", { createdAt: now }),
      rec("loss", { createdAt: now - 10 * DAY }),
    ];
    assert.equal(filterByPeriod(recs, "today", now).length, 1);
    assert.equal(filterByPeriod(recs, "7d", now).length, 1);
    assert.equal(filterByPeriod(recs, "30d", now).length, 2);
    assert.equal(filterByPeriod(recs, "all", now).length, 2);
  });
});

describe("computeRecommendationStats — the R record", () => {
  const T0 = 1_700_000_000_000;

  it("builds the equity curve in exit order with running cumulative R", () => {
    const stats = computeRecommendationStats([
      // Deliberately out of creation order: the curve follows EXITS.
      rec("loss", { id: "b", slHitAt: T0 + 2000, realizedR: -1 }),
      rec("win_tp1", { id: "a", tp1HitAt: T0 + 1000, exitAt: T0 + 1000, realizedR: 1 }),
    ]);
    assert.deepEqual(
      stats.equityCurve.map((p) => p.id),
      ["a", "b"],
    );
    assert.deepEqual(
      stats.equityCurve.map((p) => p.cumR),
      [1, 0],
    );
    assert.equal(stats.totalRealizedR, 0);
  });

  it("legacy rows without measurements still enter the curve by their own levels", () => {
    const stats = computeRecommendationStats([
      rec("win_tp2", { tp2HitAt: T0 + 1000, exitAt: T0 + 1000 }), // targets[1]=104 → +2R
      rec("loss", { slHitAt: T0 + 2000 }), // -1R by touch semantics
    ]);
    assert.deepEqual(
      stats.equityCurve.map((p) => p.r),
      [2, -1],
    );
    assert.equal(stats.totalRealizedR, 1);
  });

  it("quotes expectancy and profit factor only above the sample floor", () => {
    const below = computeRecommendationStats([
      rec("win_tp1", { realizedR: 1 }),
      rec("loss", { realizedR: -1 }),
    ]);
    assert.equal(below.expectancyR, null);
    assert.equal(below.profitFactor, null);
    // Averages are descriptive, not quoted rates — they always show.
    assert.equal(below.avgWinR, 1);
    assert.equal(below.avgLossR, -1);

    const above = computeRecommendationStats([
      ...Array.from({ length: 6 }, () => rec("win_tp1", { realizedR: 1 })),
      rec("loss", { realizedR: -1 }),
      rec("loss", { realizedR: -1.2 }),
    ]);
    assert.equal(above.expectancyR, 0.48); // (6 - 2.2) / 8
    assert.equal(above.profitFactor, 2.73); // 6 / 2.2
  });

  it("activation rate is fills over terminal plans", () => {
    const stats = computeRecommendationStats([
      rec("win_tp1"),
      rec("loss"),
      rec("expired", { triggeredAt: undefined }),
      rec("expired", { triggeredAt: undefined }),
      rec("pending", { triggeredAt: undefined }), // still open: not in the denominator
    ]);
    assert.equal(stats.activationRate, 0.5);
  });

  it("averages the sweep's persisted excursions where they exist", () => {
    const stats = computeRecommendationStats([
      rec("win_tp1", { mfeR: 1.5, maeR: -0.4, timeInTradeMs: 60_000 }),
      rec("loss", { mfeR: 0.5, maeR: -1, timeInTradeMs: 180_000 }),
      rec("win_tp2"), // legacy: unmeasured, excluded from the means
    ]);
    assert.equal(stats.avgMfeR, 1);
    assert.equal(stats.avgMaeR, -0.7);
    assert.equal(stats.avgTimeInTradeMs, 120_000);
  });

  it("zero-fills every terminal grade and counts the fine taxonomy", () => {
    const stats = computeRecommendationStats([
      rec("win_tp1"),
      rec("expired", { triggeredAt: undefined, missedWithoutFill: true }),
      rec("cancelled", { cancelledAt: T0, supersededAt: T0 }),
    ]);
    const byGrade = new Map(stats.byGrade.map((g) => [g.grade, g.count]));
    assert.equal(byGrade.get("win_tp1"), 1);
    assert.equal(byGrade.get("missed_opportunity"), 1);
    assert.equal(byGrade.get("superseded"), 1);
    assert.equal(byGrade.get("loss"), 0); // present even at zero
    assert.equal(stats.byGrade.length >= 13, true);
  });

  it("tracks streaks over wins and losses only", () => {
    const stats = computeRecommendationStats([
      rec("win_tp1", { exitAt: T0 + 1000, realizedR: 1 }),
      rec("win_tp2", { exitAt: T0 + 2000, realizedR: 2 }),
      rec("expired", { triggeredAt: undefined, expiredAt: T0 + 2500 }), // ignored
      rec("loss", { slHitAt: T0 + 3000, realizedR: -1 }),
      rec("win_tp1", { exitAt: T0 + 4000, realizedR: 1 }),
    ]);
    assert.equal(stats.streaks.longestWins, 2);
    assert.equal(stats.streaks.longestLosses, 1);
    assert.deepEqual(stats.streaks.current, { kind: "win", length: 1 });
  });

  it("recent outcomes are newest first and carry the grade", () => {
    const stats = computeRecommendationStats([
      rec("win_tp1", { id: "old", exitAt: T0 + 1000, realizedR: 1 }),
      rec("loss", { id: "new", slHitAt: T0 + 5000, realizedR: -1 }),
    ]);
    assert.deepEqual(
      stats.recentOutcomes.map((o) => o.id),
      ["new", "old"],
    );
    assert.equal(stats.recentOutcomes[0]!.grade, "loss");
    assert.equal(stats.recentOutcomes[0]!.r, -1);
  });

  it("groups by trading session from the fill time", () => {
    // 13:00 UTC on a Wednesday: London and New York overlap — NY leads.
    const nyOverlap = Date.UTC(2024, 0, 10, 14, 30);
    const stats = computeRecommendationStats([
      rec("win_tp1", { triggeredAt: nyOverlap }),
    ]);
    assert.equal(stats.bySession.length, 1);
    assert.equal(stats.bySession[0]!.key, "newyork");
  });
});
