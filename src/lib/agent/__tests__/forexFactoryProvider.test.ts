import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { createForexFactoryProvider } from "@/lib/agent/news/providers/forexFactoryProvider";
import { getNewsProvider, newsProviderConfigured } from "@/lib/agent/news/newsProvider";
import { resetCalendarCacheForTests } from "@/lib/agent/news/calendarCache";
import { clearPlatformConfigCache } from "@/lib/platformConfig";

const realFetch = globalThis.fetch;

function stubFetch(body: unknown, status = 200): void {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    })) as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = realFetch;
  // getNewsProvider routes through the platform calendar cache — reset it or
  // one test's schedule is served to the next.
  resetCalendarCacheForTests();
  delete process.env.FMP_API_KEY;
  delete process.env.NEWS_API_KEY;
  delete process.env.ECONOMIC_CALENDAR_API_KEY;
  delete process.env.FOREX_FACTORY_CALENDAR_V1;
  // getPlatformValue memoizes the first env read — clear it or a flag set in
  // one test poisons every later test in the process.
  clearPlatformConfigCache();
});

describe("forexFactoryProvider", () => {
  it("maps the weekly feed shape and filters to requested currencies", async () => {
    const now = Date.now();
    const inWindow = new Date(now + 30 * 60 * 1000).toISOString();
    stubFetch([
      { title: "Non-Farm Employment Change", country: "USD", date: inWindow, impact: "High" },
      { title: "German Ifo Business Climate", country: "EUR", date: inWindow, impact: "Medium" },
      { title: "BOJ Press Conference", country: "JPY", date: inWindow, impact: "High" },
      { title: "Bank Holiday", country: "GBP", date: inWindow, impact: "Holiday" },
    ]);
    const provider = createForexFactoryProvider();
    const events = await provider.getEconomicEvents({
      currencies: ["EUR", "USD"],
      from: new Date(now),
      to: new Date(now + 6 * 60 * 60 * 1000),
    });
    assert.equal(events.length, 2);
    assert.equal(events[0]!.impact, "high");
    assert.equal(events[1]!.impact, "medium");
  });

  it("drops malformed rows instead of guessing, and Holiday reads as low", async () => {
    const now = Date.now();
    const inWindow = new Date(now + 30 * 60 * 1000).toISOString();
    stubFetch([
      { title: "OK Event", country: "USD", date: inWindow, impact: "Holiday" },
      { title: "", country: "USD", date: inWindow, impact: "High" },
      { title: "No date", country: "USD", impact: "High" },
      { title: "Bad date", country: "USD", date: "not-a-date", impact: "High" },
      { count: 3 },
    ]);
    const provider = createForexFactoryProvider();
    const events = await provider.getEconomicEvents({
      currencies: ["USD"],
      from: new Date(now),
      to: new Date(now + 6 * 60 * 60 * 1000),
    });
    assert.equal(events.length, 1);
    assert.equal(events[0]!.impact, "low");
  });

  it("gold requests include USD events and macro-term titles", async () => {
    const now = Date.now();
    const inWindow = new Date(now + 30 * 60 * 1000).toISOString();
    stubFetch([
      { title: "Retail Sales m/m", country: "USD", date: inWindow, impact: "Medium" },
      { title: "FOMC Statement", country: "ALL", date: inWindow, impact: "High" },
      { title: "French CPI", country: "EUR", date: inWindow, impact: "Low" },
    ]);
    const provider = createForexFactoryProvider();
    const events = await provider.getEconomicEvents({
      currencies: ["XAU", "USD"],
      from: new Date(now),
      to: new Date(now + 6 * 60 * 60 * 1000),
    });
    // The USD row matches by currency; the FOMC row (currency "ALL") matches
    // through the shared gold-terms rule, exactly like the FMP source.
    assert.ok(events.some((e) => e.title === "Retail Sales m/m"));
    assert.ok(events.some((e) => e.title === "FOMC Statement"));
  });

  it("a non-array body throws so the agent degrades honestly", async () => {
    stubFetch({ error: "maintenance" });
    const provider = createForexFactoryProvider();
    await assert.rejects(() =>
      provider.getEconomicEvents({
        currencies: ["USD"],
        from: new Date(),
        to: new Date(Date.now() + 1000),
      }),
    );
  });
});

describe("merged calendar sources", () => {
  it("FF alone (no keys) makes the platform configured", () => {
    delete process.env.FMP_API_KEY;
    assert.equal(newsProviderConfigured(), true);
    process.env.FOREX_FACTORY_CALENDAR_V1 = "false";
    assert.equal(newsProviderConfigured(), false);
  });

  it("with both sources, an exact duplicate is emitted once", async () => {
    process.env.FMP_API_KEY = "k";
    const now = Date.now();
    const t = new Date(now + 45 * 60 * 1000).toISOString();
    // One stub serves both upstreams: FMP reads {event,country}, FF reads
    // {title,country,date} — include both shapes for the SAME release plus one
    // FF-only event.
    stubFetch([
      { date: t, event: "CPI y/y", country: "US", impact: "High" },
      { title: "CPI y/y", country: "USD", date: t, impact: "High" },
      { title: "Fed Chair Powell Speaks", country: "USD", date: t, impact: "High" },
    ]);
    const provider = getNewsProvider()!;
    const events = await provider.getEconomicEvents({
      currencies: ["USD"],
      from: new Date(now),
      to: new Date(now + 6 * 60 * 60 * 1000),
    });
    const cpi = events.filter((e) => e.title.toLowerCase().includes("cpi"));
    assert.equal(cpi.length, 1, "same release from two sources must merge");
    assert.ok(events.some((e) => e.title.includes("Powell")));
  });

  it("one source failing still serves the other's calendar", async () => {
    process.env.FMP_API_KEY = "k";
    const now = Date.now();
    const t = new Date(now + 45 * 60 * 1000).toISOString();
    let call = 0;
    globalThis.fetch = (async (url: RequestInfo | URL) => {
      call += 1;
      const u = String(url);
      if (u.includes("financialmodelingprep")) {
        return new Response("down", { status: 503 });
      }
      return new Response(
        JSON.stringify([{ title: "ECB Rate Decision", country: "EUR", date: t, impact: "High" }]),
        { status: 200 },
      );
    }) as typeof fetch;
    const provider = getNewsProvider()!;
    const events = await provider.getEconomicEvents({
      currencies: ["EUR", "USD"],
      from: new Date(now),
      to: new Date(now + 6 * 60 * 60 * 1000),
    });
    assert.ok(call >= 2);
    assert.equal(events.length, 1);
    assert.equal(events[0]!.title, "ECB Rate Decision");
  });

  it("ALL sources failing throws — never a quiet empty week", async () => {
    process.env.FMP_API_KEY = "k";
    stubFetch("down", 503);
    const provider = getNewsProvider()!;
    await assert.rejects(() =>
      provider.getEconomicEvents({
        currencies: ["USD"],
        from: new Date(),
        to: new Date(Date.now() + 1000),
      }),
    );
  });
});
