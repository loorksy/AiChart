/**
 * Trading-session awareness, pinned against real instants.
 *
 * The dates are chosen so DST does the interesting work: the same UTC hour
 * puts New York inside its session in one month and outside it in another,
 * which is exactly the mistake a fixed-UTC-offset table would make.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getTradingSessionInfo,
  isSessionOpen,
  tradingSessionPromptBlock,
} from "@/lib/agent/core/tradingSessions";

describe("session windows follow each center's own clock", () => {
  it("London + New York overlap on a winter Wednesday afternoon (UTC 15:00)", () => {
    // 2026-01-14 15:00 UTC → London 15:00 GMT (open), New York 10:00 EST
    // (open), Tokyo 00:00 Thu (closed), Sydney 02:00 Thu (closed).
    const info = getTradingSessionInfo(Date.UTC(2026, 0, 14, 15, 0));
    assert.deepEqual(info.active, ["london", "newyork"]);
    assert.equal(info.overlap, "london_newyork");
    assert.equal(info.primary, "newyork", "the later center's open leads the tape");
    assert.equal(info.nextOpen, null, "nextOpen is only for the weekend gap");
  });

  it("the same overlap holds in summer — both centers shifted together (DST)", () => {
    // 2026-07-15 15:00 UTC → London 16:00 BST (open), New York 11:00 EDT (open).
    const info = getTradingSessionInfo(Date.UTC(2026, 6, 15, 15, 0));
    assert.deepEqual(info.active, ["london", "newyork"]);
    assert.equal(info.overlap, "london_newyork");
  });

  it("US DST alone decides whether 12:30 UTC includes New York", () => {
    // 2026-03-05: US still on EST → 07:30 New York, before the open.
    const beforeDst = getTradingSessionInfo(Date.UTC(2026, 2, 5, 12, 30));
    assert.ok(!beforeDst.active.includes("newyork"), "07:30 EST is pre-open");
    assert.equal(beforeDst.primary, "london");
    assert.equal(beforeDst.overlap, null);

    // 2026-03-25: US on EDT (from Mar 8), London still on GMT (until Mar 29)
    // → 08:30 New York, inside the session. Same UTC hour, different answer.
    const insideDst = getTradingSessionInfo(Date.UTC(2026, 2, 25, 12, 30));
    assert.ok(insideDst.active.includes("newyork"), "08:30 EDT is open");
    assert.equal(insideDst.overlap, "london_newyork");
  });

  it("Asia hours: Sydney and Tokyo overlap while London and New York sleep", () => {
    // 2026-01-14 02:00 UTC → Tokyo 11:00 (open), Sydney 13:00 AEDT (open).
    const info = getTradingSessionInfo(Date.UTC(2026, 0, 14, 2, 0));
    assert.deepEqual(info.active, ["sydney", "tokyo"]);
    assert.equal(info.overlap, "sydney_tokyo");
    assert.equal(info.primary, "tokyo");
  });

  it("isSessionOpen respects each center's weekday in ITS calendar", () => {
    // Sunday 21:00 UTC is already Monday 08:00 AEDT in Sydney — the week has
    // opened there while it is still Sunday in New York.
    const sundayEveningUtc = Date.UTC(2026, 0, 18, 21, 0);
    assert.equal(isSessionOpen("sydney", sundayEveningUtc), true);
    assert.equal(isSessionOpen("newyork", sundayEveningUtc), false);
  });
});

describe("the weekend gap names the next session", () => {
  it("Saturday midday: nothing active, Sydney opens the week", () => {
    // Saturday 2026-01-17 12:00 UTC. Sydney opens Monday 07:00 AEDT
    // (= Sunday 20:00 UTC), 32 hours later.
    const info = getTradingSessionInfo(Date.UTC(2026, 0, 17, 12, 0));
    assert.deepEqual(info.active, []);
    assert.equal(info.primary, null);
    assert.equal(info.overlap, null);
    assert.ok(info.nextOpen, "the gap must name what comes next");
    assert.equal(info.nextOpen!.session, "sydney");
    assert.equal(info.nextOpen!.inMs, 32 * 3_600_000);
  });
});

describe("the prompt block states facts the model may cite", () => {
  it("names the active session and the overlap", () => {
    const block = tradingSessionPromptBlock(
      getTradingSessionInfo(Date.UTC(2026, 0, 14, 15, 0)),
    );
    assert.match(block, /London/);
    assert.match(block, /New York/);
    assert.match(block, /overlap/i);
    assert.match(block, /never name a different session/i);
  });

  it("says plainly when no center is open, and what opens next", () => {
    const block = tradingSessionPromptBlock(
      getTradingSessionInfo(Date.UTC(2026, 0, 17, 12, 0)),
    );
    assert.match(block, /no major center is open/i);
    assert.match(block, /Sydney opens in 32h/);
  });
});
