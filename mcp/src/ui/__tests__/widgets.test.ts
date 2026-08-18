import assert from "node:assert/strict";
import vm from "node:vm";
import { describe, it } from "node:test";
import { formatBridgeResult } from "../../bridge/client.js";
import { formatToolTextFallback } from "../../bridge/textFallback.js";
import { uiMeta } from "../../tools/registry.js";
import { TOOL_CATALOG } from "../../tools/schemas/index.js";
import type { ToolDefinition } from "../../tools/schemas/types.js";
import { RESOURCE_URI_META_KEY } from "@modelcontextprotocol/ext-apps/server";
import { appsUri, resourceContentsMeta, skybridgeUri, uiMetaFor, widgetHtmlByPublicPath } from "../index.js";
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
    assert.equal(meta["openai/toolInvocation/invoking"], "تشغيل Lonora...");
    const origin = publicAssetOrigin();
    assert.deepEqual(meta["openai/widgetCSP"], {
      connect_domains: [origin],
      resource_domains: [origin],
    });
  });

  it("paints the live chart in-document so Claude CSP cannot block a nested iframe", () => {
    const origin = publicAssetOrigin();
    const meta = uiMetaFor("live-chart");
    assert.equal(appsUri("live-chart"), "ui://aichart/live-chart/v10");
    assert.equal(appsUri("chart-drawn"), "ui://aichart/chart-drawn/v10");
    assert.deepEqual(meta["openai/widgetCSP"], {
      connect_domains: [origin],
      resource_domains: [origin],
    });
    const ui = meta.ui as {
      prefersBorder?: boolean;
      csp?: {
        frameDomains?: string[];
        connectDomains?: string[];
        resourceDomains?: string[];
      };
    };
    assert.equal(ui.prefersBorder, false);
    assert.deepEqual(ui.csp, {});
    const contents = resourceContentsMeta("live-chart") as {
      ui?: { csp?: { frameDomains?: string[] } };
      "openai/widgetCSP"?: { frame_domains?: string[] };
    };
    assert.deepEqual(contents.ui?.csp, {});
    assert.equal(contents["openai/widgetCSP"], undefined);
    const html = WIDGETS["live-chart"];
    assert.ok(html.includes('id="cv"'));
    assert.ok(html.includes('AIC.callTool("get_ohlc"'));
    assert.ok(html.includes('AIC.callTool("get_chart_state"'));
    assert.ok(!html.includes("<iframe"));
    assert.ok(!html.includes("/embed/chart"));
    assert.ok(!html.includes("embed_url"));
    assert.ok(!html.includes('class="card"'));
    assert.ok(html.includes('name="color-scheme"'));
    assert.ok(html.includes("host-context-changed"));
    assert.ok(html.includes("aic:theme"));
    assert.ok(html.includes("function inkOn"));
    assert.ok(html.includes("function paintChip"));
    assert.ok(html.includes("isLightTheme"));
  });

  it("registry uiMeta matches ui index helper", () => {
    assert.deepEqual(uiMeta("account-overview"), uiMetaFor("account-overview"));
  });

  it("resolves public HTTP paths for native and skybridge templates", () => {
    // `portfolio` was deleted with the account tools. This test is about path
    // and mime resolution, so it runs on a card that still exists.
    const native = widgetHtmlByPublicPath("recommendation-card/v1");
    assert.ok(native);
    assert.equal(native.uri, "ui://aichart/recommendation-card/v5");
    assert.ok(native.html.length > 200);
    assert.equal(native.mimeType, "text/html;profile=mcp-app");

    const gpt = widgetHtmlByPublicPath("recommendation-card/v1-gpt");
    assert.ok(gpt);
    assert.equal(gpt.uri, "ui://aichart/recommendation-card/v5-gpt");
    assert.equal(gpt.mimeType, "text/html+skybridge");
  });

  it("shells are self-contained (inline runtime, no external assets)", () => {
    for (const [name, html] of Object.entries(WIDGETS) as [string, string][]) {
      assert.ok(html.includes("window.AIC"), `${name} must inline the AIC runtime`);
      assert.ok(!/<(script|link)[^>]+(src|href)=/i.test(html), `${name} must not reference external assets`);
      assert.ok(html.includes('name="color-scheme"'), `${name} must declare color-scheme so the host backdrop stays transparent`);
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
      portfolio: { connection: { balance: 86.4, equity: 84.62, online: true }, openTrades: [] },
      live: {
        connection: { balance: 86.4, equity: 84.62, online: true },
        forex: {
          positions: [{ symbol: "XAUUSDm", side: "buy", profit: -1.78 }],
        },
        openTrades: [{ symbol: "XAUUSDm", side: "buy", profit: -1.78 }],
      },
    });
    assert.ok(text?.includes("86.4"));
    assert.ok(text?.includes("84.62"));
  });

  it("marks unresolved open PnL as unavailable when nothing reports it", () => {
    const text = formatToolTextFallback({
      risk: {},
      portfolio: {},
      live: { connection: { online: false } },
    });
    assert.ok(text?.includes("— / no data"));
  });

  it("formats account overview in Arabic when locale is ar", () => {
    const text = formatToolTextFallback({
      locale: "ar",
      risk: {},
      portfolio: {},
      live: { connection: { online: false } },
    });
    assert.ok(text?.includes("— / لا توجد بيانات"));
  });

  it("formats direct live account payloads from get_live_account", () => {
    const text = formatToolTextFallback({
      locale: "ar",
      connection: {
        online: true,
        login: "252493119",
        server: "Exness-Real",
        account_trade_mode: "live",
        balance: 86.4,
        equity: 84.62,
      },
      forex: {
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
    assert.ok(text?.includes("Exness-Real"));
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

  // The account-overview card was deleted with the account tools — the
  // platform holds no broker account, so there is no equity or balance to
  // render and no shared parser for it to share.

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
        conn: { stale: boolean; label: string };
      };
    };
    const parsed = api.parseAccountOverview({
      live: { connection: { server: "Exness", balance: 86.4, equity: 84.62, online: true } },
    });
    assert.equal(parsed.balance, 86.4);
    assert.equal(parsed.equity, 84.62);
    assert.equal(parsed.conn.stale, false);
  });

  it("recommendation card recognizes wrapped scan candidate payloads", () => {
    const html = WIDGETS["recommendation-card"];
    assert.ok(html.includes("unwrapPayload"));
    assert.ok(html.includes("data.candidates"));
    assert.ok(html.includes("data.recommendations"));
    assert.ok(html.includes("rec.score"));
  });

  it("registers a card for every surface that has one", () => {
    // The floor was 13 when account, open-trades, approval and readiness cards
    // existed. They do not; a floor that can only be met by keeping dead HTML
    // is not a guard. What matters is that nothing points at a missing widget,
    // which "links card tools to registered widgets" below checks directly.
    assert.ok(Object.keys(WIDGETS).length >= 8, `got ${Object.keys(WIDGETS).length}`);
  });
});

describe("catalog card-linked tools", () => {
  it("links card tools to registered widgets", () => {
    const linked = TOOL_CATALOG.filter((t: ToolDefinition) => t.ui?.widget);
    assert.ok(linked.length >= 8, `got ${linked.length}`);
    for (const tool of linked) {
      assert.ok(WIDGETS[tool.ui!.widget], `${tool.name} → missing widget ${tool.ui!.widget}`);
    }
  });
});
