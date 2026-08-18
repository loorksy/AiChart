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
