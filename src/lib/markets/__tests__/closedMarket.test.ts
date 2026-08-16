/**
 * A closed pair is a named operational blocker, per symbol.
 *
 * Two properties matter and are easy to lose:
 *  - the answer is about the SYMBOL asked for, not the chart the operator
 *    happens to be looking at (gold halts for its maintenance hour while FX
 *    keeps trading);
 *  - "closed" is a first-class state with a reason, never a silent empty
 *    result and never a "wait" dressed up as analysis.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { getSessionStatus, isMarketOpenAt } from "@/lib/markets/tradingCalendar";
import { userMessageForFailure } from "@/lib/agent/errorTaxonomy";

/** 2026-08-01 is a Saturday; 12:00 UTC is deep inside the weekend. */
const SATURDAY = Date.parse("2026-08-01T12:00:00Z");
/** 2026-08-05 is a Wednesday; 14:00 UTC = 10:00 New York — mid-session. */
const WEDNESDAY_OPEN = Date.parse("2026-08-05T14:00:00Z");
/** 21:30 UTC on that Wednesday = 17:30 New York — the metals halt hour. */
const WEDNESDAY_METAL_BREAK = Date.parse("2026-08-05T21:30:00Z");

test("the weekend closes the market", () => {
  assert.equal(isMarketOpenAt("XAUUSD", SATURDAY), false);
  const status = getSessionStatus("XAUUSD", new Date(SATURDAY));
  assert.equal(status.isOpen, false);
  assert.ok(status.reason.includes("السبت"), status.reason);
});

test("gold is shut during its daily maintenance hour", () => {
  assert.equal(isMarketOpenAt("XAUUSD", WEDNESDAY_OPEN), true);
  assert.equal(isMarketOpenAt("XAUUSD", WEDNESDAY_METAL_BREAK), false);
  // Any spelling is the same instrument and gets the same verdict.
  assert.equal(isMarketOpenAt("XAUUSDm", WEDNESDAY_METAL_BREAK), false);
});

test("a closed market always comes with a reason to show the operator", () => {
  const gold = getSessionStatus("XAUUSD", new Date(WEDNESDAY_METAL_BREAK));
  assert.equal(gold.isOpen, false);
  assert.ok(gold.reason.trim().length > 0);
  const open = getSessionStatus("EURUSD", new Date(WEDNESDAY_OPEN));
  assert.equal(open.isOpen, true);
});

test("the refusal is scoped to a fresh operator read", () => {
  // Pinned as source structure because exercising the orchestrator needs a
  // model seam; what matters is that the three exemptions stay explicit:
  // a replayed fixture, a re-evaluation of an existing plan, and a question
  // that never asked for market context at all.
  const source = readFileSync(
    resolve(process.cwd(), "src/lib/agent/orchestrator.ts"),
    "utf8",
  );
  assert.match(source, /failureCode: "market_closed"/);
  assert.match(source, /timeBasis \?\? "live"\) === "live"/);
  assert.match(source, /input\.purpose !== "reevaluation"/);
  assert.match(source, /wantMarket &&\s*\n\s*!educationalOnly/);
});

test("the blocker code speaks for itself in both languages", () => {
  const ar = userMessageForFailure("market_closed", "ar");
  const en = userMessageForFailure("market_closed", "en");
  assert.ok(ar.includes("مغلق"), ar);
  assert.ok(/closed/i.test(en), en);
  // It must not read as a generic fault — a closed session is not an outage.
  assert.notEqual(ar, userMessageForFailure("unknown", "ar"));
});
