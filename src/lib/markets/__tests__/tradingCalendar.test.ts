import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getSessionStatus,
  isExpectedDailyBarOpen,
  isMarketOpenAt,
  nyWallHourForTest,
  resolveTradingClass,
} from "@/lib/markets/tradingCalendar";

// 2026 US DST: begins Sunday March 8, ends Sunday November 1.
const ms = (iso: string) => Date.parse(iso);
const GOLD = "XAUUSD";

describe("resolveTradingClass", () => {
  it("is always metal — gold is the platform's only instrument", () => {
    assert.equal(resolveTradingClass("XAUUSD"), "metal");
    assert.equal(resolveTradingClass("XAUUSDm"), "metal");
  });
});

describe("NY wall time (DST-exact)", () => {
  it("maps UTC to the correct NY hour in both regimes", () => {
    // Summer (EDT, UTC-4): 21:00 UTC = 17:00 NY.
    assert.deepEqual(nyWallHourForTest(ms("2026-07-21T21:00:00Z")), {
      weekday: 2,
      hour: 17,
    });
    // Winter (EST, UTC-5): 22:00 UTC = 17:00 NY.
    assert.deepEqual(nyWallHourForTest(ms("2026-01-20T22:00:00Z")), {
      weekday: 2,
      hour: 17,
    });
  });
});

describe("gold week boundaries", () => {
  it("closes Friday 17:00 NY in summer (21:00 UTC)", () => {
    assert.equal(isMarketOpenAt(GOLD, ms("2026-07-24T20:59:00Z")), true);
    assert.equal(isMarketOpenAt(GOLD, ms("2026-07-24T21:00:00Z")), false);
  });

  it("closes Friday 17:00 NY in winter (22:00 UTC)", () => {
    assert.equal(isMarketOpenAt(GOLD, ms("2026-01-23T21:30:00Z")), true);
    assert.equal(isMarketOpenAt(GOLD, ms("2026-01-23T22:00:00Z")), false);
  });

  it("Saturday is closed all day", () => {
    assert.equal(isMarketOpenAt(GOLD, ms("2026-07-25T12:00:00Z")), false);
  });
});

describe("metals daily maintenance break", () => {
  it("gold halts [17:00, 18:00) NY on weekdays — the phantom-gap fix", () => {
    // Tuesday in summer: 21:00–22:00 UTC is the break.
    assert.equal(isMarketOpenAt(GOLD, ms("2026-07-21T20:59:00Z")), true);
    assert.equal(isMarketOpenAt(GOLD, ms("2026-07-21T21:00:00Z")), false);
    assert.equal(isMarketOpenAt(GOLD, ms("2026-07-21T21:45:00Z")), false);
    assert.equal(isMarketOpenAt(GOLD, ms("2026-07-21T22:00:00Z")), true);
    // Same break in winter lands 22:00–23:00 UTC.
    assert.equal(isMarketOpenAt(GOLD, ms("2026-01-20T22:30:00Z")), false);
    assert.equal(isMarketOpenAt(GOLD, ms("2026-01-20T23:00:00Z")), true);
  });

  it("every 15m bar of the gold break hour is expected-closed (4 bars/day)", () => {
    const breakBars = ["21:00", "21:15", "21:30", "21:45"].map((t) =>
      ms(`2026-07-21T${t}:00Z`),
    );
    for (const bar of breakBars) {
      assert.equal(isMarketOpenAt(GOLD, bar), false);
    }
  });

  it("gold opens Sunday 18:00 NY — an hour later than the fx week open", () => {
    // 21:30 UTC is 17:30 NY: fx would be open, gold is not yet.
    assert.equal(isMarketOpenAt(GOLD, ms("2026-07-26T21:30:00Z")), false);
    assert.equal(isMarketOpenAt(GOLD, ms("2026-07-26T22:00:00Z")), true);
  });
});

describe("expected daily bars (17:00 NY alignment)", () => {
  function countExpectedDailyBars(fromIso: string, toIso: string): number {
    let count = 0;
    for (let t = ms(fromIso); t < ms(toIso); t += 3_600_000) {
      if (isExpectedDailyBarOpen("XAUUSD", t)) count += 1;
    }
    return count;
  }

  it("accepts Sun–Thu 17:00 NY opens and rejects everything else", () => {
    // Monday 17:00 EDT.
    assert.equal(isExpectedDailyBarOpen("XAUUSD", ms("2026-07-20T21:00:00Z")), true);
    // Sunday 17:00 EDT (the bar covering Monday's session).
    assert.equal(isExpectedDailyBarOpen("XAUUSD", ms("2026-07-26T21:00:00Z")), true);
    // Friday 17:00 EDT — weekend, no bar.
    assert.equal(isExpectedDailyBarOpen("XAUUSD", ms("2026-07-24T21:00:00Z")), false);
    // Monday 18:00 EDT — wrong hour.
    assert.equal(isExpectedDailyBarOpen("XAUUSD", ms("2026-07-20T22:00:00Z")), false);
    // Winter Monday 17:00 EST = 22:00 UTC; 21:00 UTC is 16:00 EST.
    assert.equal(isExpectedDailyBarOpen("XAUUSD", ms("2026-01-19T22:00:00Z")), true);
    assert.equal(isExpectedDailyBarOpen("XAUUSD", ms("2026-01-19T21:00:00Z")), false);
  });

  it("expects exactly 5 daily bars in a normal week", () => {
    assert.equal(countExpectedDailyBars("2026-07-18T00:00:00Z", "2026-07-25T00:00:00Z"), 5);
    assert.equal(countExpectedDailyBars("2026-01-17T00:00:00Z", "2026-01-24T00:00:00Z"), 5);
  });

  it("expects exactly 5 daily bars across BOTH 2026 DST transition weeks", () => {
    // Spring forward: Sunday 2026-03-08.
    assert.equal(countExpectedDailyBars("2026-03-07T00:00:00Z", "2026-03-14T00:00:00Z"), 5);
    // Fall back: Sunday 2026-11-01.
    assert.equal(countExpectedDailyBars("2026-10-31T00:00:00Z", "2026-11-07T00:00:00Z"), 5);
  });
});

describe("session status reasons", () => {
  it("keeps the operator-facing Arabic reasons", () => {
    const saturday = getSessionStatus(GOLD, new Date(ms("2026-07-25T12:00:00Z")));
    assert.equal(saturday.isOpen, false);
    assert.match(saturday.reason, /السبت/);

    const fridayClose = getSessionStatus(GOLD, new Date(ms("2026-07-24T22:00:00Z")));
    assert.equal(fridayClose.isOpen, false);
    assert.match(fridayClose.reason, /الجمعة/);

    const goldBreak = getSessionStatus(GOLD, new Date(ms("2026-07-21T21:30:00Z")));
    assert.equal(goldBreak.isOpen, false);
    assert.match(goldBreak.reason, /الصيانة/);

    const open = getSessionStatus(GOLD, new Date(ms("2026-07-21T22:30:00Z")));
    assert.equal(open.isOpen, true);
  });
});


