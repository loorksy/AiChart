/**
 * The recommendation's event timeline — a pure projection of the persisted
 * record. Same record, same timeline, whether rendered as the mini strip on
 * a list card or the full ledger on the detail page.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildRecommendationTimeline } from "@/lib/recommendations/timeline";
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
    priceAtCreation: 100.4,
    ...over,
  };
}

describe("buildRecommendationTimeline", () => {
  it("a fresh plan has exactly its issuance", () => {
    const events = buildRecommendationTimeline(rec());
    assert.equal(events.length, 1);
    assert.equal(events[0]!.type, "issued");
    assert.equal(events[0]!.at, T0);
    assert.equal(events[0]!.price, 100.4);
  });

  it("a partial win tells the whole story in order: issued, activated, TP1, stopped", () => {
    const events = buildRecommendationTimeline(
      rec({
        status: "tp1_hit",
        outcome: "win_tp1",
        triggeredAt: T0 + 2 * M,
        tp1HitAt: T0 + 10 * M,
        slHitAt: T0 + 20 * M,
        realizedR: 1,
      }),
    );
    assert.deepEqual(
      events.map((e) => e.type),
      ["issued", "activated", "tp1_hit", "stopped"],
    );
    const tp1 = events[2]!;
    assert.equal(tp1.price, 102);
    assert.equal(tp1.r, 1); // (102-100)/2
    // The stop that closed the remainder is SHOWN, but carries no R of its
    // own — the record closed at the banked target.
    const stopped = events[3]!;
    assert.equal(stopped.at, T0 + 20 * M);
    assert.equal(stopped.price, 98);
    assert.equal(stopped.r, null);
  });

  it("a loss carries the measured exit R on the stop event", () => {
    const events = buildRecommendationTimeline(
      rec({
        status: "sl_hit",
        outcome: "loss",
        triggeredAt: T0 + M,
        slHitAt: T0 + 8 * M,
        realizedR: -1.2,
        exitPrice: 97.6,
      }),
    );
    const stopped = events.at(-1)!;
    assert.equal(stopped.type, "stopped");
    assert.equal(stopped.price, 97.6);
    assert.equal(stopped.r, -1.2);
  });

  it("a missed opportunity is its own event, not a plain expiry", () => {
    const events = buildRecommendationTimeline(
      rec({
        status: "expired",
        outcome: "expired",
        expiredAt: T0 + 30 * M,
        missedWithoutFill: true,
      }),
    );
    assert.deepEqual(
      events.map((e) => e.type),
      ["issued", "missed_opportunity"],
    );
  });

  it("an expiry in trade reads expired with the exit facts", () => {
    const events = buildRecommendationTimeline(
      rec({
        status: "expired",
        outcome: "expired",
        triggeredAt: T0 + M,
        expiredAt: T0 + 40 * M,
        exitPrice: 101,
        realizedR: 0.5,
      }),
    );
    const expired = events.at(-1)!;
    assert.equal(expired.type, "expired");
    assert.equal(expired.price, 101);
    assert.equal(expired.r, 0.5);
  });

  it("superseded and withdrawn are different endings", () => {
    const superseded = buildRecommendationTimeline(
      rec({
        status: "cancelled",
        outcome: "cancelled",
        cancelledAt: T0 + 5 * M,
        supersededAt: T0 + 5 * M,
      }),
    );
    assert.equal(superseded.at(-1)!.type, "superseded");

    const withdrawn = buildRecommendationTimeline(
      rec({
        status: "cancelled",
        outcome: "cancelled",
        cancelledAt: T0 + 5 * M,
      }),
    );
    assert.equal(withdrawn.at(-1)!.type, "cancelled");
  });

  it("survived stop breaches appear once, with their count", () => {
    const events = buildRecommendationTimeline(
      rec({
        status: "triggered",
        outcome: "pending",
        triggeredAt: T0 + M,
        stopBreachSurvivedCount: 2,
        lastStopBreachSurvivedAt: T0 + 12 * M,
      }),
    );
    const breach = events.find((e) => e.type === "stop_breach_survived");
    assert.ok(breach, "the survival is on the record");
    assert.equal(breach!.count, 2);
    assert.equal(breach!.price, 98);
  });

  it("grades R against the effective entry, never the nominal one", () => {
    const events = buildRecommendationTimeline(
      rec({
        entryType: "confirmation_close",
        effectiveEntry: 101,
        status: "tp1_hit",
        outcome: "win_tp1",
        triggeredAt: T0 + M,
        tp1HitAt: T0 + 6 * M,
        slHitAt: T0 + 9 * M,
      }),
    );
    const tp1 = events.find((e) => e.type === "tp1_hit")!;
    assert.equal(tp1.r, 0.33); // (102-101)/|101-98|
  });

  it("events sharing a timestamp keep lifecycle order", () => {
    const events = buildRecommendationTimeline(
      rec({
        status: "tp3_hit",
        outcome: "win_tp3",
        triggeredAt: T0 + M,
        tp1HitAt: T0 + M,
        tp2HitAt: T0 + M,
        tp3HitAt: T0 + M,
      }),
    );
    assert.deepEqual(
      events.map((e) => e.type),
      ["issued", "activated", "tp1_hit", "tp2_hit", "tp3_hit"],
    );
  });
});
