/**
 * The platform calendar cache's four contractual proofs:
 *
 *   1. analyses inside the freshness window share ONE upstream fetch
 *      (single-flight for the concurrent ones, the cache for the rest);
 *   2. blocking arithmetic is computed at READ time from the server clock —
 *      a cache fetched minutes ago blocks and clears by live distance, never
 *      by how old the snapshot is;
 *   3. the freshness window ADAPTS: nearest high-impact event within two
 *      hours shrinks it from the default to the near-event TTL;
 *   4. fail-closed is untouched: a fetch failure with a cache older than the
 *      hard maximum rethrows, and the news gate blocks exactly as it did
 *      before the cache existed.
 *
 * Plus the two edges of the failure path: a tolerably-stale cache serves the
 * stored schedule on a fetch failure, and no cache at all still throws.
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  getCalendarEvents,
  resetCalendarCacheForTests,
} from "@/lib/agent/news/calendarCache";
import type { EconomicEvent } from "@/lib/agent/news/newsProvider";
import type { NewsMacroResult } from "@/lib/agent/agents/newsMacroAgent";
import { evaluateNewsWindow } from "@/lib/agent/gates/newsWindow";
import { buildGates } from "@/lib/agent/gates/buildGates";
import { runGateChain } from "@/lib/agent/gates/chain";

const T0 = Date.parse("2026-08-05T10:00:00Z");
const MIN = 60_000;

function highEventAt(time: number, title = "US CPI"): EconomicEvent {
  return { title, time: new Date(time).toISOString(), impact: "high", currency: "USD" };
}

/** A counting fetcher that always serves the given schedule. */
function scheduleFetcher(events: EconomicEvent[]) {
  const state = { calls: 0 };
  return {
    state,
    fetch: async () => {
      state.calls += 1;
      return events;
    },
  };
}

function windowInput(now: number) {
  return {
    currencies: ["XAU", "USD"],
    from: new Date(now),
    to: new Date(now + 6 * 60 * MIN),
  };
}

beforeEach(() => resetCalendarCacheForTests());
afterEach(() => resetCalendarCacheForTests());

describe("platform calendar cache", () => {
  it("50 analyses inside the freshness window share one upstream fetch", async () => {
    // Medium impact only, so the default 15-minute window applies throughout.
    const event: EconomicEvent = {
      title: "US Retail Sales",
      time: new Date(T0 + 40 * MIN).toISOString(),
      impact: "medium",
      currency: "USD",
    };
    const upstream = scheduleFetcher([event]);
    let clock = T0;
    const deps = { now: () => clock, fetch: upstream.fetch };

    // A burst of concurrent analyses coalesces onto a single in-flight fetch…
    const burst = await Promise.all(
      Array.from({ length: 50 }, () => getCalendarEvents(windowInput(clock), deps)),
    );
    assert.equal(upstream.state.calls, 1, "concurrent analyses must single-flight");
    for (const events of burst) {
      assert.equal(events.length, 1);
      assert.equal(events[0]!.title, "US Retail Sales");
    }

    // …and later analyses inside the window read the stored schedule.
    clock = T0 + 10 * MIN;
    for (let i = 0; i < 10; i++) {
      const events = await getCalendarEvents(windowInput(clock), deps);
      assert.equal(events.length, 1);
    }
    assert.equal(upstream.state.calls, 1, "a fresh cache never refetches");
  });

  it("a stored schedule blocks and clears by LIVE distance, not fetch age", async () => {
    // CPI thirty minutes after the fetch. The block window is 30 before / 15
    // after: the verdict must flip twice on the SAME stored data.
    const upstream = scheduleFetcher([highEventAt(T0 + 30 * MIN)]);
    let clock = T0;
    const deps = {
      now: () => clock,
      fetch: upstream.fetch,
      // Both TTLs are configurable; hold the cache fresh across the whole
      // scenario so every verdict below provably comes from storage.
      ttlDefaultMs: 60 * MIN,
      ttlNearEventMs: 60 * MIN,
    };

    await getCalendarEvents(windowInput(clock), deps); // prime at 10:00
    assert.equal(upstream.state.calls, 1);

    // 10:10 — cache is ten minutes old, CPI is twenty minutes ahead: blocked.
    clock = T0 + 10 * MIN;
    const events = await getCalendarEvents(windowInput(clock), deps);
    assert.equal(upstream.state.calls, 1, "the ten-minute-old cache serves this read");
    const toBlocking = events.map((e) => ({
      title: e.title,
      time: Date.parse(e.time),
      impact: e.impact,
      currency: e.currency,
    }));
    const during = evaluateNewsWindow({
      events: toBlocking,
      now: clock,
      window: { before: 30, after: 15 },
    });
    assert.equal(during.blocked, true, "20 minutes out is inside the 30-minute window");
    assert.equal(during.event?.title, "US CPI");

    // 10:46 — sixteen minutes after the print, same stored schedule: clear.
    clock = T0 + 46 * MIN;
    const after = await getCalendarEvents(windowInput(clock), deps);
    assert.equal(upstream.state.calls, 1, "still the same snapshot");
    const cleared = evaluateNewsWindow({
      events: after.map((e) => ({
        title: e.title,
        time: Date.parse(e.time),
        impact: e.impact,
        currency: e.currency,
      })),
      now: clock,
      window: { before: 30, after: 15 },
    });
    assert.equal(cleared.blocked, false, "same data, later clock, opposite verdict");
  });

  it("the freshness window shrinks once a high-impact event is within two hours", async () => {
    // High-impact print three hours out: beyond the horizon at first.
    const upstream = scheduleFetcher([highEventAt(T0 + 180 * MIN, "FOMC Statement")]);
    let clock = T0;
    const deps = { now: () => clock, fetch: upstream.fetch };

    await getCalendarEvents(windowInput(clock), deps);
    assert.equal(upstream.state.calls, 1);

    // +5 min, event 2h55m away → default 15-minute window → cache is fresh.
    clock = T0 + 5 * MIN;
    await getCalendarEvents(windowInput(clock), deps);
    assert.equal(upstream.state.calls, 1, "far from the event, 5 minutes is fresh");

    // +66 min, event 1h54m away → the 2-minute near-event window applies, the
    // 66-minute-old cache is stale, and the calendar is re-fetched.
    clock = T0 + 66 * MIN;
    await getCalendarEvents(windowInput(clock), deps);
    assert.equal(upstream.state.calls, 2, "near the event the window must shrink");

    // +67 min → one minute since the refetch: fresh even at the short window.
    clock = T0 + 67 * MIN;
    await getCalendarEvents(windowInput(clock), deps);
    assert.equal(upstream.state.calls, 2);
  });

  it("a fetch failure with a cache older than the hard max throws — and G1 blocks", async () => {
    const upstream = scheduleFetcher([highEventAt(T0 + 40 * MIN)]);
    let clock = T0;
    let broken = false;
    const deps = {
      now: () => clock,
      fetch: async () => {
        if (broken) throw new Error("upstream 429");
        return upstream.fetch();
      },
    };

    await getCalendarEvents(windowInput(clock), deps); // prime at 10:00
    broken = true;

    // Two hours and one minute later the stored calendar is beyond the hard
    // max: the failure propagates instead of a stale schedule being served.
    clock = T0 + 121 * MIN;
    await assert.rejects(
      () => getCalendarEvents(windowInput(clock), deps),
      /upstream 429/,
      "a calendar older than the hard max must be rejected, not served",
    );

    // The thrown failure reaches the news agent, which degrades to unknown —
    // and an unknown news window refuses publication, exactly as before.
    const unknownNews: NewsMacroResult = {
      newsRisk: "unknown",
      biasImpact: "unknown",
      affectedCurrencies: ["XAU", "USD"],
      upcomingEvents: [],
      tradeAllowed: true,
      reason: "News provider request failed.",
    };
    const { gates } = buildGates({
      now: clock,
      news: unknownNews,
      newsProviderConfigured: true,
      structure: null,
      liquidity: null,
      supplyDemand: null,
      mtf: null,
      atr: 4,
      plan: {
        direction: "buy" as const,
        entryType: "limit_touch" as const,
        entry: 4340.5,
        stopLoss: 4334.5,
        targets: [4352.5],
      },
      fetchLivePrice: async () => 4340.9,
    });
    const verdict = await runGateChain(gates);
    assert.equal(verdict.allowed, false, "an unverifiable calendar never passes");
    assert.equal(verdict.vetoedBy?.id, "G1");
    assert.equal(verdict.vetoedBy?.status, "unavailable");
  });

  it("a fetch failure with a tolerably-stale cache serves the stored schedule", async () => {
    let clock = T0;
    let calls = 0;
    const deps = {
      now: () => clock,
      fetch: async () => {
        calls += 1;
        if (calls > 1) throw new Error("upstream down");
        return [highEventAt(T0 + 50 * MIN)];
      },
    };

    await getCalendarEvents(windowInput(clock), deps);

    // Thirty minutes old — past every freshness window, inside the hard max:
    // the refetch fails and the stored schedule still answers.
    clock = T0 + 30 * MIN;
    const events = await getCalendarEvents(windowInput(clock), deps);
    assert.equal(calls, 2, "a refetch was attempted");
    assert.equal(events.length, 1);
    assert.equal(events[0]!.title, "US CPI");
  });

  it("a fetch failure with no cache at all still throws", async () => {
    const deps = {
      now: () => T0,
      fetch: async () => {
        throw new Error("cold start 429");
      },
    };
    await assert.rejects(() => getCalendarEvents(windowInput(T0), deps), /cold start 429/);
  });
});
