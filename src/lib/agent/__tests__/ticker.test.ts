import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  generateTickerPlan,
  parseTickerPlan,
} from "@/lib/agent/ticker/generateTickerPlan";
import { streamTicker } from "@/lib/agent/ticker/streamTicker";
import { sanitizeTickerText } from "@/lib/agent/ticker/sanitizeTicker";
import type { AgentTickerItem } from "@/lib/agent/ticker/types";

const VALID_PLAN = JSON.stringify({
  items: [
    { stage: "thinking", text: "أفهم طلبك حول EURUSD" },
    { stage: "market_context", text: "أبني سياق السوق على فريم 15m" },
    { stage: "risk", text: "أوازن المخاطرة قبل القرار" },
  ],
});

describe("generateTickerPlan", () => {
  it("returns sanitized items from a valid model response", async () => {
    const items = await generateTickerPlan(
      {
        userMessage: "حلل الشارت",
        symbol: "EURUSD",
        interval: "15m",
        intent: ["chart_analysis"],
        hasChartContext: true,
        newsProviderConfigured: false,
        canUseMarketTools: true,
        canUseNewsTools: false,
      },
      { configured: true, callModel: async () => VALID_PLAN },
    );
    assert.equal(items.length, 3);
    assert.ok(items.every((i) => i.text.length >= 2 && i.text.length <= 70));
    assert.ok(items.every((i) => i.id));
  });

  it("throws when the LLM is not configured (caller hides ticker)", async () => {
    await assert.rejects(
      generateTickerPlan(
        {
          userMessage: "مرحبا",
          intent: ["general_question"],
          hasChartContext: false,
          newsProviderConfigured: false,
          canUseMarketTools: false,
          canUseNewsTools: false,
        },
        { configured: false },
      ),
    );
  });

  it("throws on invalid/garbage model output — no static fallback", async () => {
    await assert.rejects(
      generateTickerPlan(
        {
          userMessage: "حلل",
          intent: ["chart_analysis"],
          hasChartContext: true,
          newsProviderConfigured: false,
          canUseMarketTools: true,
          canUseNewsTools: false,
        },
        { configured: true, callModel: async () => "not json at all" },
      ),
    );
  });

  it("strips chain-of-thought phrasing from ticker text", () => {
    const items = parseTickerPlan(
      JSON.stringify({
        items: [
          { stage: "thinking", text: "chain of thought تحليل الزوج" },
          { stage: "finalizing", text: "أجهّز الرد النهائي" },
        ],
      }),
    );
    assert.ok(items.every((i) => !i.text.toLowerCase().includes("chain of thought")));
  });

  it("accepts fenced JSON output", () => {
    const items = parseTickerPlan("```json\n" + VALID_PLAN + "\n```");
    assert.equal(items.length, 3);
  });
});

describe("streamTicker", () => {
  it("emits items in order and stops at plan end (last item stays visible)", async () => {
    const emitted: AgentTickerItem[] = [];
    const items: AgentTickerItem[] = [
      { id: "1", stage: "thinking", text: "أ" },
      { id: "2", stage: "risk", text: "ب" },
      { id: "3", stage: "finalizing", text: "ج" },
    ];
    await streamTicker({
      items,
      sendTicker: (i) => emitted.push(i),
      shouldStop: () => false,
      delayMs: () => 1,
    });
    assert.deepEqual(emitted.map((i) => i.id), ["1", "2", "3"]);
  });

  it("stops immediately when shouldStop is true", async () => {
    const emitted: AgentTickerItem[] = [];
    await streamTicker({
      items: [{ id: "1", stage: "thinking", text: "أ" }],
      sendTicker: (i) => emitted.push(i),
      shouldStop: () => true,
      delayMs: () => 1,
    });
    assert.equal(emitted.length, 0);
  });

  it("does nothing with an empty plan (ticker hidden)", async () => {
    const emitted: AgentTickerItem[] = [];
    await streamTicker({
      items: [],
      sendTicker: (i) => emitted.push(i),
      shouldStop: () => false,
      delayMs: () => 1,
    });
    assert.equal(emitted.length, 0);
  });
});

describe("sanitizeTickerText", () => {
  it("caps length at 70 and strips trailing dots", () => {
    assert.ok(sanitizeTickerText("x".repeat(200)).length <= 70);
    assert.equal(sanitizeTickerText("أفحص السوق ..."), "أفحص السوق");
  });
});
