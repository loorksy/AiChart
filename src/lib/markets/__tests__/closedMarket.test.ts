/**
 * A closed market is a SCENARIO, not a refusal.
 *
 * This file used to pin the opposite: an early return in the orchestrator
 * answering every weekend request with `market_closed` and "come back when
 * the session opens" — while the Telegram greeting promised "والتوصية تنتظر
 * الافتتاح". The promise now has the code path, and these tests pin it:
 *
 *  - the calendar still names closed states with an operator-facing reason;
 *  - `resolveClosedMarketScenario` decides scenario mode as a CALL, with the
 *    three standing exemptions (reevaluation / replay / educational) as real
 *    arguments instead of source strings a regex hunts for;
 *  - the model's activation deadlines shift to the open, or a weekend plan
 *    would be born with triggers that expire ~40 hours before the first
 *    candle that could satisfy them;
 *  - and the refusal machinery is GONE — `market_closed` is no longer a
 *    failure code anything can emit.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { getSessionStatus, isMarketOpenAt } from "@/lib/markets/tradingCalendar";
import {
  resolveClosedMarketScenario,
  scenarioNoticeAr,
  shiftActivationRuleExpiries,
} from "@/lib/agent/closedMarketScenario";

/** 2026-08-01 is a Saturday; 12:00 UTC is deep inside the weekend. */
const SATURDAY = Date.parse("2026-08-01T12:00:00Z");
/** 2026-08-05 is a Wednesday; 14:00 UTC = 10:00 New York — mid-session. */
const WEDNESDAY_OPEN = Date.parse("2026-08-05T14:00:00Z");
/** 21:30 UTC on that Wednesday = 17:30 New York — the metals halt hour. */
const WEDNESDAY_METAL_BREAK = Date.parse("2026-08-05T21:30:00Z");

const live = {
  symbol: "XAUUSD",
  wantMarket: true,
  educationalOnly: false,
  nowMs: SATURDAY,
};

test("the weekend closes the market, with the operator-facing reason", () => {
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

test("a Saturday request enters scenario mode, anchored at Sunday's open", () => {
  const scenario = resolveClosedMarketScenario(live);
  assert.ok(scenario, "a fresh weekend read must produce a scenario");
  // Aug 2 2026 is a Sunday; 18:00 NY in EDT = 22:00 UTC.
  assert.equal(scenario!.nextOpenAt, Date.parse("2026-08-02T22:00:00Z"));
  assert.ok(scenario!.reasonAr.includes("السبت"));
});

test("mid-session there is no scenario — the run is simply live", () => {
  assert.equal(
    resolveClosedMarketScenario({ ...live, nowMs: WEDNESDAY_OPEN }),
    null,
  );
});

test("the three standing exemptions hold, as calls rather than regexes", () => {
  // A re-evaluation revisits an existing plan against the latest data there
  // is — weekends included. A replay has its own clock. Educational-only
  // sessions produce no recommendation either way.
  assert.equal(
    resolveClosedMarketScenario({ ...live, purpose: "reevaluation" }),
    null,
  );
  assert.equal(resolveClosedMarketScenario({ ...live, timeBasis: "replay" }), null);
  assert.equal(
    resolveClosedMarketScenario({ ...live, educationalOnly: true }),
    null,
  );
  assert.equal(resolveClosedMarketScenario({ ...live, wantMarket: false }), null);
});

test("activation deadlines shift to the open, composites included", () => {
  const sixHours = 6 * 3_600_000;
  const shifted = shiftActivationRuleExpiries(
    {
      kind: "composite",
      operator: "all",
      expiresAt: SATURDAY + sixHours,
      rules: [
        { kind: "price_touch", level: 4000, expiresAt: SATURDAY + sixHours },
        { kind: "candle_close_above", level: 4005 },
      ],
    },
    Date.parse("2026-08-02T22:00:00Z") - SATURDAY,
  );
  assert.ok(shifted.kind === "composite");
  // Every stated deadline now lands AFTER the open; absent ones stay absent.
  assert.ok(shifted.expiresAt! > Date.parse("2026-08-02T22:00:00Z"));
  assert.ok(shifted.rules[0]!.expiresAt! > Date.parse("2026-08-02T22:00:00Z"));
  assert.equal(shifted.rules[1]!.expiresAt, undefined);
});

test("the notice says closed, scenario, conditional — deterministically", () => {
  const notice = scenarioNoticeAr(resolveClosedMarketScenario(live)!);
  assert.ok(notice.includes("السوق مغلق الآن"));
  assert.ok(notice.includes("سيناريو"));
  assert.ok(notice.includes("شرطية"));
  assert.ok(notice.includes("بتوقيت الرياض"));
});

test("the orchestrator runs the scenario instead of refusing", () => {
  const source = readFileSync(
    resolve(process.cwd(), "src/lib/agent/orchestrator.ts"),
    "utf8",
  );
  // The wiring that must exist…
  assert.match(source, /resolveClosedMarketScenario\(/);
  assert.match(source, /scenarioNoticeAr\(/);
  assert.match(source, /shiftActivationRuleExpiries\(/);
  assert.match(source, /marketClosedScenario \?\? undefined/);
  // …and the refusal that must not. A failure code nothing emits was also
  // deleted from the taxonomy, so this cannot quietly come back as a string.
  assert.doesNotMatch(source, /failureCode: "market_closed"/);
});

test("the analyze route no longer refuses a closed market with a 409", () => {
  const source = readFileSync(
    resolve(process.cwd(), "src/app/api/agent/market/analyze/route.ts"),
    "utf8",
  );
  assert.doesNotMatch(source, /"market_closed"/);
  assert.doesNotMatch(source, /status: 409/);
});

test("scenario plans are forced conditional before the gates read them", () => {
  const source = readFileSync(
    resolve(process.cwd(), "src/lib/agent/orchestrator.ts"),
    "utf8",
  );
  // The force lives in `prepareDecision`, which every decision — the authored
  // one AND a stale-scenario reprice retry — passes through before the gate
  // evaluation reads it. Source order proves the gates see the forced plan.
  const force = source.indexOf('decision.planType = "conditional"');
  const gates = source.indexOf("buildGates({");
  assert.ok(force > 0, "the deterministic force must exist");
  assert.ok(gates > 0, "the gate chain must exist");
  assert.ok(force < gates, "the gates must see the forced plan, not the model's");
});
