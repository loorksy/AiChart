/**
 * The chart anchors the profit/loss zones at the recommendation's created_at.
 * This suite pins the stamping rule that keeps that anchor STABLE across
 * agent turns, layout polls, MCP re-writes, and reloads — the second round of
 * the "المناطق تتحرك مع الشمعة" bug, where payloads built without created_at
 * made the zones re-anchor to "now" on every redraw.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createdAtMs,
  sameTradePlan,
  withStableCreatedAt,
  type TradePlanAnchorFields,
} from "@/lib/recommendations/anchorTime";

const PLAN: TradePlanAnchorFields = {
  symbol: "XAUUSD",
  action: "buy",
  entry: 4646.19,
  stop_loss: 4642.93,
  take_profit: 4660.02,
};

describe("createdAtMs", () => {
  it("parses ISO strings, epoch ms, and epoch seconds", () => {
    assert.equal(createdAtMs("2026-08-24T18:00:00.000Z"), Date.UTC(2026, 7, 24, 18));
    assert.equal(createdAtMs(Date.UTC(2026, 7, 24, 18)), Date.UTC(2026, 7, 24, 18));
    assert.equal(createdAtMs(1_787_940_000), 1_787_940_000_000);
  });

  it("rejects absent or unparseable values", () => {
    assert.equal(createdAtMs(undefined), null);
    assert.equal(createdAtMs(null), null);
    assert.equal(createdAtMs(""), null);
    assert.equal(createdAtMs("not a date"), null);
    assert.equal(createdAtMs(0), null);
  });
});

describe("withStableCreatedAt", () => {
  it("keeps a persisted created_at byte-for-byte — never re-serialized", () => {
    const next = { ...PLAN, created_at: "2026-08-24T18:00:00.000Z" };
    assert.equal(withStableCreatedAt(next, null), next, "same reference back");
  });

  it("a re-delivered same plan without created_at inherits the previous anchor", () => {
    const prev = { ...PLAN, created_at: "2026-08-24T18:00:00.000Z" };
    const redelivered = { ...PLAN };
    const out = withStableCreatedAt(redelivered, prev, "2026-08-25T09:00:00.000Z");
    assert.equal(out?.created_at, "2026-08-24T18:00:00.000Z");
  });

  it("stamps a genuinely NEW plan exactly once with the given instant", () => {
    const prev = { ...PLAN, created_at: "2026-08-24T18:00:00.000Z" };
    const newPlan = { ...PLAN, entry: 4700, stop_loss: 4690, take_profit: 4720 };
    const out = withStableCreatedAt(newPlan, prev, "2026-08-25T09:00:00.000Z");
    assert.equal(
      out?.created_at,
      "2026-08-25T09:00:00.000Z",
      "a different plan must not steal the old plan's anchor",
    );
  });

  it("stamps when there is no previous plan at all (legacy stored layout)", () => {
    const out = withStableCreatedAt({ ...PLAN }, null, "2026-08-25T09:00:00.000Z");
    assert.equal(out?.created_at, "2026-08-25T09:00:00.000Z");
  });

  it("re-hydrating the stamped plan converges — the poll never re-anchors", () => {
    // Cycle 1: layout delivers a legacy payload; it is stamped once.
    const first = withStableCreatedAt({ ...PLAN }, null, "2026-08-25T09:00:00.000Z");
    // Cycle 2 (4s later): the SAME stored payload arrives again, still without
    // created_at; it must inherit the stamp, producing an identical object.
    const second = withStableCreatedAt({ ...PLAN }, first, "2026-08-25T09:00:04.000Z");
    assert.deepEqual(second, first, "identical payloads must hydrate identically");
  });

  it("passes null through", () => {
    assert.equal(withStableCreatedAt(null, { ...PLAN, created_at: "x" }), null);
  });
});

describe("sameTradePlan", () => {
  it("matches on side + entry/stop/target (symbol only when both declare one)", () => {
    assert.ok(sameTradePlan(PLAN, { ...PLAN }));
    assert.ok(sameTradePlan(PLAN, { ...PLAN, symbol: undefined }));
    assert.ok(!sameTradePlan(PLAN, { ...PLAN, symbol: "EURUSD" }));
    assert.ok(!sameTradePlan(PLAN, { ...PLAN, action: "sell" }));
    assert.ok(!sameTradePlan(PLAN, { ...PLAN, entry: 1 }));
    assert.ok(!sameTradePlan(PLAN, { ...PLAN, stop_loss: 1 }));
    assert.ok(!sameTradePlan(PLAN, { ...PLAN, take_profit: 1 }));
    assert.ok(!sameTradePlan(null, PLAN));
    assert.ok(!sameTradePlan(PLAN, null));
  });
});
