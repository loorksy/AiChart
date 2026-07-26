import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  deriveLifecycleEvents,
  proximityThreshold,
} from "@/lib/recommendations/lifecycleEvents";
import type { TrackedRecommendation } from "@/lib/recommendations/types";

function rec(
  over: Partial<
    Pick<
      TrackedRecommendation,
      "id" | "symbol" | "direction" | "entry" | "stopLoss" | "invalidationLevel" | "status" | "outcome"
    >
  > = {},
) {
  return {
    id: "rec-1",
    symbol: "XAUUSD",
    direction: "buy" as const,
    entry: 4000,
    stopLoss: 3990,
    invalidationLevel: 3990,
    status: "pending_entry" as const,
    outcome: "pending" as const,
    ...over,
  };
}

describe("lifecycle events", () => {
  it("says nothing when nothing moved", () => {
    const events = deriveLifecycleEvents({
      recommendation: rec(),
      previousStatus: "pending_entry",
      nextStatus: "pending_entry",
      currentPrice: 4050, // far from both the entry and the invalidation
      atr: 2,
      revisionNo: 1,
    });
    assert.deepEqual(events, []);
  });

  it("announces activation exactly once per real transition", () => {
    const events = deriveLifecycleEvents({
      recommendation: rec({ status: "triggered" }),
      previousStatus: "pending_entry",
      nextStatus: "triggered",
      currentPrice: 4000,
      atr: 2,
      revisionNo: 1,
    });
    const activated = events.filter((e) => e.type === "activated");
    assert.equal(activated.length, 1);
    assert.equal(activated[0]!.dedupeKey, "rec-1:1:activated");
  });

  it("warns when price approaches the entry zone", () => {
    const events = deriveLifecycleEvents({
      recommendation: rec(),
      previousStatus: "pending_entry",
      nextStatus: "pending_entry",
      currentPrice: 4001,
      atr: 2,
      revisionNo: 1,
    });
    assert.ok(events.some((e) => e.type === "approaching_entry"));
  });

  it("warns when price approaches the level that kills the idea", () => {
    const events = deriveLifecycleEvents({
      recommendation: rec({ status: "triggered" }),
      previousStatus: "triggered",
      nextStatus: "triggered",
      currentPrice: 3991,
      atr: 2,
      revisionNo: 1,
    });
    assert.ok(events.some((e) => e.type === "approaching_invalidation"));
  });

  it("does not warn about invalidation once price is already through it", () => {
    // Past the level is a status change for the evaluator to report, not a
    // proximity warning — announcing both would double-count the same moment.
    const events = deriveLifecycleEvents({
      recommendation: rec({ status: "triggered" }),
      previousStatus: "triggered",
      nextStatus: "triggered",
      currentPrice: 3989,
      atr: 2,
      revisionNo: 1,
    });
    assert.ok(!events.some((e) => e.type === "approaching_invalidation"));
  });

  it("re-announces after a revision, because the plan genuinely changed", () => {
    const first = deriveLifecycleEvents({
      recommendation: rec(),
      previousStatus: "pending_entry",
      nextStatus: "pending_entry",
      currentPrice: 4001,
      atr: 2,
      revisionNo: 1,
    });
    const second = deriveLifecycleEvents({
      recommendation: rec({ entry: 3995 }),
      previousStatus: "pending_entry",
      nextStatus: "pending_entry",
      currentPrice: 3996,
      atr: 2,
      revisionNo: 2,
      revisionJustApplied: { revisionNo: 2, reason: "بحث عميق حسّن سعر الدخول" },
    });
    assert.ok(second.some((e) => e.type === "entry_updated"));
    // Same event type, different revision → a different dedupe identity.
    const firstKey = first.find((e) => e.type === "approaching_entry")?.dedupeKey;
    const secondKey = second.find((e) => e.type === "approaching_entry")?.dedupeKey;
    assert.notEqual(firstKey, secondKey);
  });

  it("marks terminal events as terminal", () => {
    for (const status of ["sl_hit", "tp1_hit", "expired", "invalidated"] as const) {
      const events = deriveLifecycleEvents({
        recommendation: rec({ status }),
        previousStatus: "triggered",
        nextStatus: status,
        currentPrice: 4000,
        atr: 2,
        revisionNo: 1,
      });
      assert.ok(events.some((e) => e.terminal), status);
    }
  });

  it("scales the proximity band with the instrument", () => {
    assert.equal(proximityThreshold({ atr: 2, price: 4000 }), 1.5);
    // No ATR → a small fraction of price rather than a fixed pip count.
    assert.ok(proximityThreshold({ atr: null, price: 4000 }) > 0);
  });
});
