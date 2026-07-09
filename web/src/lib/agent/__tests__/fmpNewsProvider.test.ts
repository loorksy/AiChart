import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  createFmpProvider,
  clearFmpCache,
} from "@/lib/agent/news/providers/fmpProvider";
import { runNewsMacroAgent } from "@/lib/agent/agents/newsMacroAgent";
import type { AgentActivityEvent, AgentRunContext } from "@/lib/agent/types";

const realFetch = globalThis.fetch;

function stubFetch(rows: unknown): void {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(rows), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })) as typeof fetch;
}

function fakeCtx(
  events: Array<Omit<AgentActivityEvent, "id" | "timestamp">> = [],
): AgentRunContext {
  return { requestId: "t", emitActivity: (e) => events.push(e) };
}

afterEach(() => {
  globalThis.fetch = realFetch;
  clearFmpCache();
  delete process.env.FMP_API_KEY;
});

describe("fmpProvider", () => {
  it("filters events to the requested pair currencies (both sides)", async () => {
    const now = Date.now();
    const inWindow = new Date(now + 60 * 60 * 1000).toISOString();
    stubFetch([
      { date: inWindow, event: "US CPI", country: "US", impact: "High" },
      { date: inWindow, event: "ECB Rate Decision", country: "EU", impact: "High" },
      { date: inWindow, event: "BOJ Statement", country: "JP", impact: "High" },
    ]);
    const provider = createFmpProvider("test-key");
    const events = await provider.getEconomicEvents({
      currencies: ["EUR", "USD"],
      from: new Date(now),
      to: new Date(now + 6 * 60 * 60 * 1000),
    });
    assert.equal(events.length, 2);
    assert.ok(events.every((e) => e.currency === "USD" || e.currency === "EUR"));
  });

  it("gold checks USD events AND Fed/CPI/NFP/FOMC-term events", async () => {
    const now = Date.now();
    const inWindow = new Date(now + 60 * 60 * 1000).toISOString();
    stubFetch([
      { date: inWindow, event: "US Retail Sales", country: "US", impact: "Medium" },
      { date: inWindow, event: "Fed Chair Powell Speaks", country: "", impact: "High" },
      { date: inWindow, event: "ECB Minutes", country: "EU", impact: "High" },
    ]);
    const provider = createFmpProvider("test-key");
    const events = await provider.getEconomicEvents({
      currencies: ["XAU", "USD"],
      from: new Date(now),
      to: new Date(now + 6 * 60 * 60 * 1000),
    });
    assert.equal(events.length, 2);
    assert.ok(events.some((e) => e.title.includes("Powell")));
    assert.ok(!events.some((e) => e.title.includes("ECB")));
  });

  it("news agent classifies HIGH risk for a high-impact event within the hour", async () => {
    process.env.FMP_API_KEY = "test-key";
    const now = Date.now();
    const soon = new Date(now + 30 * 60 * 1000).toISOString();
    stubFetch([{ date: soon, event: "US NFP", country: "US", impact: "High" }]);

    const events: Array<Omit<AgentActivityEvent, "id" | "timestamp">> = [];
    const res = await runNewsMacroAgent(fakeCtx(events), {
      symbol: "EURUSD",
      message: "الأخبار؟",
    });
    assert.equal(res.newsRisk, "high");
    assert.equal(res.tradeAllowed, false);
    // With a REAL provider request, the review announcement IS truthful.
    assert.ok(
      events.some((e) => String(e.message).includes("أراجع الأخبار")),
    );
  });

  it("provider failure degrades to unknown honestly", async () => {
    process.env.FMP_API_KEY = "test-key";
    globalThis.fetch = (async () =>
      new Response("upstream down", { status: 503 })) as typeof fetch;

    const res = await runNewsMacroAgent(fakeCtx(), {
      symbol: "EURUSD",
      message: "الأخبار؟",
    });
    assert.equal(res.newsRisk, "unknown");
    assert.equal(res.upcomingEvents.length, 0);
  });
});
