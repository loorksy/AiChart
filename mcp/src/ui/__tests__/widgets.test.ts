import assert from "node:assert/strict";
import vm from "node:vm";
import { describe, it } from "node:test";
import { formatBridgeResult } from "../../bridge/client.js";
import { formatToolTextFallback } from "../../bridge/textFallback.js";
import { uiMeta } from "../../tools/registry.js";
import { TOOL_CATALOG } from "../../tools/schemas/index.js";
import type { ToolDefinition } from "../../tools/schemas/types.js";
import { RESOURCE_URI_META_KEY } from "@modelcontextprotocol/ext-apps/server";
import { appsUri, skybridgeUri, uiMetaFor, widgetHtmlByPublicPath } from "../index.js";
import { publicAssetOrigin, RUNTIME_JS } from "../runtime.js";
import { WIDGETS } from "../widgets.js";

describe("MCP UI resources", () => {
  it("registers versioned canonical URIs for flagship cards", () => {
    assert.equal(appsUri("account-overview"), "ui://aichart/account-overview/v5");
    assert.equal(appsUri("analysis"), "ui://aichart/analysis/v5");
    assert.equal(appsUri("portfolio"), "ui://aichart/portfolio/v3");
    assert.equal(skybridgeUri("account-overview"), "ui://aichart/account-overview/v5-gpt");
    assert.equal(skybridgeUri("analysis"), "ui://aichart/analysis/v5-gpt");
  });

  it("emits MCP Apps and OpenAI compatibility metadata", () => {
    const meta = uiMetaFor("analysis");
    const uri = appsUri("analysis");
    assert.equal((meta.ui as { resourceUri: string }).resourceUri, uri);
    assert.equal(meta[RESOURCE_URI_META_KEY], uri);
    assert.equal(meta["openai/outputTemplate"], skybridgeUri("analysis"));
    assert.equal(meta["openai/toolInvocation/invoking"], "تشغيل AiChart...");
    const origin = publicAssetOrigin();
    assert.deepEqual(meta["openai/widgetCSP"], {
      connect_domains: [origin],
      resource_domains: [origin],
    });
  });

  it("registry uiMeta matches ui index helper", () => {
    assert.deepEqual(uiMeta("account-overview"), uiMetaFor("account-overview"));
  });

  it("resolves public HTTP paths for native and skybridge templates", () => {
    const native = widgetHtmlByPublicPath("portfolio/v1");
    assert.ok(native);
    assert.equal(native.uri, "ui://aichart/portfolio/v3");
    assert.ok(native.html.length > 200);
    assert.equal(native.mimeType, "text/html;profile=mcp-app");

    const gpt = widgetHtmlByPublicPath("portfolio/v1-gpt");
    assert.ok(gpt);
    assert.equal(gpt.uri, "ui://aichart/portfolio/v3-gpt");
    assert.equal(gpt.mimeType, "text/html+skybridge");
  });

  it("shells are self-contained (inline runtime, no external assets)", () => {
    for (const [name, html] of Object.entries(WIDGETS) as [string, string][]) {
      assert.ok(html.includes("window.AIC"), `${name} must inline the AIC runtime`);
      assert.ok(!/<(script|link)[^>]+(src|href)=/i.test(html), `${name} must not reference external assets`);
    }
  });
});

describe("structured tool text fallback", () => {
  it("formats account overview from verified broker facts", () => {
    const text = formatToolTextFallback({
      risk: {
        ok: true,
        data: {
        },
      },
      portfolio: { forex: { ea: { balance: 86.4, equity: 84.62, online: true } }, openTrades: [] },
      live: {
        forex: {
          ea: { balance: 86.4, equity: 84.62, online: true, heartbeatFresh: true },
          heartbeatFresh: true,
          positions: [{ symbol: "XAUUSDm", side: "buy", profit: -1.78 }],
        },
        openTrades: [{ symbol: "XAUUSDm", side: "buy", profit: -1.78 }],
      },
    });
    assert.ok(text?.includes("86.4"));
    assert.ok(text?.includes("84.62"));
  });

  it("marks stale EA open PnL as unavailable", () => {
    const text = formatToolTextFallback({
      risk: {},
      portfolio: { openPnl: 0 },
      live: { forex: { ea: { heartbeatFresh: false, online: false } } },
    });
    assert.ok(text?.includes("— / stale data"));
  });

  it("formats account overview in Arabic when locale is ar", () => {
    const text = formatToolTextFallback({
      locale: "ar",
      risk: {},
      portfolio: { openPnl: 0 },
      live: { forex: { ea: { heartbeatFresh: false, online: false } } },
    });
    assert.ok(text?.includes("— / بيانات قديمة"));
  });

  it("formats direct live account payloads from get_live_account", () => {
    const text = formatToolTextFallback({
      locale: "ar",
      forex: {
        heartbeatFresh: true,
        ea: {
          online: true,
          account_login: "252493119",
          broker_name: "Exness",
          account_trade_mode: "live",
          balance: 86.4,
          equity: 84.62,
        },
        positions: [
          { symbol: "XAUUSDm", side: "buy", profit: -1.72 },
          { symbol: "XAUUSDm", side: "buy", profit: -0.06 },
        ],
      },
      openTrades: [
        { symbol: "XAUUSDm", side: "buy", profit: -1.72 },
        { symbol: "XAUUSDm", side: "buy", profit: -0.06 },
      ],
    });
    assert.ok(text?.includes("#252493119"));
    assert.ok(text?.includes("Exness"));
    assert.ok(text?.includes("الرصيد: 86.4"));
    assert.ok(text?.includes("حقوق الملكية: 84.62"));
    assert.ok(text?.includes("PnL المفتوح: -1.78"));
  });

  it("formatBridgeResult uses readable English fallback when structured", () => {
    const out = formatBridgeResult(
      { snapshot: { symbol: "EURUSD", price: 1.08, rsi14: 55, trend: "bullish" } },
      { structured: true },
    );
    assert.ok(out.structuredContent);
    assert.ok(out.content[0]?.text.includes("EURUSD"));
    assert.ok(out.content[0]?.text.includes("Analysis EURUSD"));
    assert.ok(!out.content[0]?.text.startsWith("{"));
  });
});

describe("widget HTML safety", () => {
  it("contains no direct fetch calls in inline widget HTML", () => {
    for (const [name, html] of Object.entries(WIDGETS) as [string, string][]) {
      assert.ok(!html.includes("fetch("), `${name} must not call fetch()`);
    }
  });

  it("account overview widget uses shared parseAccountOverview helper", () => {
    const html = WIDGETS["account-overview"];
    assert.ok(html.includes("parseAccountOverview"));
    assert.ok(html.includes("equity-val"));
    assert.ok(html.includes("balance-val"));
  });

  it("runtime account parser keeps connected account numbers visible", () => {
    const window = {
      openai: { callTool: async () => ({}) },
      addEventListener() {},
      open() {},
    } as Record<string, unknown>;
    const document = {
      querySelectorAll: () => [],
      body: { clientWidth: 320, scrollHeight: 320 },
    };
    vm.runInNewContext(RUNTIME_JS, {
      window,
      document,
      setTimeout: () => 0,
      clearTimeout: () => undefined,
      Promise,
      Number,
      String,
      Object,
      Array,
      Math,
      isFinite,
    });
    const api = window.AIC as {
      parseAccountOverview(data: unknown): {
        balance: number | null;
        equity: number | null;
        ea: { stale: boolean; label: string };
      };
    };
    const parsed = api.parseAccountOverview({
      live: { forex: { ea: { broker_name: "Exness", balance: 86.4, equity: 84.62 } } },
    });
    assert.equal(parsed.balance, 86.4);
    assert.equal(parsed.equity, 84.62);
    assert.equal(parsed.ea.stale, false);
  });

  it("recommendation card recognizes wrapped scan candidate payloads", () => {
    const html = WIDGETS["recommendation-card"];
    assert.ok(html.includes("unwrapPayload"));
    assert.ok(html.includes("data.candidates"));
    assert.ok(html.includes("data.recommendations"));
    assert.ok(html.includes("rec.score"));
  });

  it("registers at least 13 interactive card widgets", () => {
    assert.ok(Object.keys(WIDGETS).length >= 13);
  });
});

describe("catalog card-linked tools", () => {
  it("links card tools to registered widgets", () => {
    const linked = TOOL_CATALOG.filter((t: ToolDefinition) => t.ui?.widget);
    assert.ok(linked.length >= 13);
    for (const tool of linked) {
      assert.ok(WIDGETS[tool.ui!.widget], `${tool.name} → missing widget ${tool.ui!.widget}`);
    }
  });
});
