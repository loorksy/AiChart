import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildSessionSpreadSchedule,
  expectedSpreadNow,
  sessionAt,
  SESSION_SPREAD_MULTIPLIER,
} from "@/lib/strategies/sessionSpread";

describe("session-aware spread", () => {
  it("orders sessions by real liquidity, not alphabetically", () => {
    // The ordering is the substance: a strategy that only works at thin Asian
    // spreads must fail on London numbers rather than pass on an average.
    assert.ok(
      SESSION_SPREAD_MULTIPLIER.london_new_york_overlap <
        SESSION_SPREAD_MULTIPLIER.london,
    );
    assert.ok(SESSION_SPREAD_MULTIPLIER.london < SESSION_SPREAD_MULTIPLIER.asia);
  });

  it("builds one entry per session, anchored to the observed spread", () => {
    const schedule = buildSessionSpreadSchedule(2);
    assert.equal(schedule.length, 4);
    const sessions = schedule.map((entry) => entry.session).sort();
    assert.deepEqual(sessions, ["asia", "london", "london_new_york_overlap", "new_york"]);
    const london = schedule.find((entry) => entry.session === "london")!;
    // The observed reading is treated as London, the usual sampling window.
    assert.equal(london.pips, 2);
    const asia = schedule.find((entry) => entry.session === "asia")!;
    assert.ok(asia.pips > london.pips);
  });

  it("never produces a negative spread from a bad reading", () => {
    for (const entry of buildSessionSpreadSchedule(-5)) {
      assert.ok(entry.pips >= 0);
    }
  });

  it("identifies the session from the hour in UTC", () => {
    assert.equal(sessionAt(new Date("2026-07-27T03:00:00Z")), "asia");
    assert.equal(sessionAt(new Date("2026-07-27T09:00:00Z")), "london");
    assert.equal(sessionAt(new Date("2026-07-27T14:00:00Z")), "london_new_york_overlap");
    assert.equal(sessionAt(new Date("2026-07-27T19:00:00Z")), "new_york");
  });

  it("quotes the spread a trade would actually pay right now", () => {
    const asia = expectedSpreadNow(2, new Date("2026-07-27T03:00:00Z"));
    const overlap = expectedSpreadNow(2, new Date("2026-07-27T14:00:00Z"));
    assert.equal(asia.session, "asia");
    assert.equal(overlap.session, "london_new_york_overlap");
    // Same setup, different cost — which is the whole point of tracking it.
    assert.ok(asia.pips > overlap.pips);
  });
});
