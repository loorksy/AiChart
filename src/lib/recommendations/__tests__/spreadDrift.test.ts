/**
 * Spread drift — the trigger that could not fire.
 *
 * The rule was written, tested at its own boundary, and then fed a hardcoded
 * `null`: the tracker set `currentSpread = null` with a comment saying no live
 * quote existed after the EA bridge was removed. So a plan costed at 20 pips
 * and now trading at 60 re-evaluated for every reason EXCEPT the one that had
 * actually invalidated it.
 *
 * A quote source exists — the same platform-level OANDA book G7 revalidates
 * against — so these tests pin the two halves that make the wiring correct:
 * the rule fires on a real widening, and the comparison happens in ONE unit.
 * That second half is not paranoia: `plannedFor` is pips, a raw ask−bid is
 * price, and on gold those differ by a factor of 100. Comparing them directly
 * would make every plan look catastrophically widened, every sweep.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { detectReevaluationTriggers } from "@/lib/recommendations/reevaluationTriggers";
import { pipSizeForSymbol } from "@/lib/spread";

const recommendation = {
  id: "rec-1",
  userId: 1,
  symbol: "XAUUSD",
  direction: "buy" as const,
  entry: 4340,
  stopLoss: 4330,
  invalidationLevel: 4330,
  revisionNo: 1,
  foundingPattern: null,
};

function triggersFor(spread: { now: number; plannedFor: number } | null) {
  return detectReevaluationTriggers({
    recommendation,
    structure: null,
    patternStage: null,
    patternStageKey: null,
    higherTimeframeBias: null,
    spread,
    invalidationProximity: null,
  }).map((trigger) => trigger.reason);
}

describe("the spread-drift trigger", () => {
  it("fires when the live spread runs away from what the plan was costed at", () => {
    assert.ok(triggersFor({ now: 60, plannedFor: 20 }).includes("spread_widened"));
  });

  it("stays quiet at the spread the plan expected", () => {
    assert.ok(!triggersFor({ now: 21, plannedFor: 20 }).includes("spread_widened"));
  });

  it("cannot fire when no quote was available", () => {
    // Absent means the check did not run, never that the spread is fine — the
    // tracker passes null rather than a zero, which would read as "no cost".
    assert.deepEqual(triggersFor(null), []);
  });

  it("is unreachable when the plan recorded no cost", () => {
    assert.ok(!triggersFor({ now: 60, plannedFor: 0 }).includes("spread_widened"));
  });
});

describe("the units the tracker converts to", () => {
  it("expresses a gold quote's spread in pips, not price", () => {
    // 0.60 in price at a pip of 0.01 is 60 pips. Handing the rule the raw 0.60
    // against a 20-pip plan would report a spread that had NARROWED 33x.
    const bid = 4340.2;
    const ask = 4340.8;
    const pips = (ask - bid) / pipSizeForSymbol("XAUUSD", (ask + bid) / 2);
    assert.ok(Math.abs(pips - 60) < 1e-6, `expected 60 pips, got ${pips}`);
    assert.ok(triggersFor({ now: pips, plannedFor: 20 }).includes("spread_widened"));
    assert.ok(
      !triggersFor({ now: ask - bid, plannedFor: 20 }).includes("spread_widened"),
      "the raw price difference must not be what the rule sees",
    );
  });
});
