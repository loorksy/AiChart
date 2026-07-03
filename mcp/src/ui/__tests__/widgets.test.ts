import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatBridgeResult } from "../../bridge/client.js";
import { formatToolTextFallback } from "../../bridge/textFallback.js";
import { uiMeta } from "../../tools/registry.js";
import { TOOL_CATALOG } from "../../tools/schemas/index.js";
import type { ToolDefinition } from "../../tools/schemas/types.js";
import { RESOURCE_URI_META_KEY } from "@modelcontextprotocol/ext-apps/server";
import { appsUri, skybridgeUri, uiMetaFor, widgetHtmlByPublicPath } from "../index.js";
import { WIDGETS } from "../widgets.js";

describe("MCP UI resources", () => {
  it("registers versioned canonical URIs for flagship cards", () => {
    assert.equal(appsUri("account-overview"), "ui://aichart/account-overview/v1");
    assert.equal(appsUri("analysis"), "ui://aichart/analysis/v1");
    assert.equal(skybridgeUri("account-overview"), "ui://aichart/account-overview/v1-gpt");
    assert.equal(skybridgeUri("analysis"), "ui://aichart/analysis/v1-gpt");
  });

  it("emits MCP Apps and OpenAI compatibility metadata", () => {
    const meta = uiMetaFor("analysis");
    const uri = appsUri("analysis");
    assert.equal((meta.ui as { resourceUri: string }).resourceUri, uri);
    assert.equal(meta[RESOURCE_URI_META_KEY], uri);
    assert.equal(meta["openai/outputTemplate"], skybridgeUri("analysis"));
    assert.equal(meta["openai/toolInvocation/invoking"], "تشغيل Lonora...");
    assert.deepEqual(meta["openai/widgetCSP"], {
      connect_domains: [],
      resource_domains: [],
    });
  });

  it("registry uiMeta matches ui index helper", () => {
    assert.deepEqual(uiMeta("account-overview"), uiMetaFor("account-overview"));
  });

  it("resolves public HTTP paths for native and skybridge templates", () => {
    const native = widgetHtmlByPublicPath("portfolio.html");
    assert.ok(native);
    assert.equal(native.uri, "ui://aichart/portfolio.html");
    assert.ok(native.html.length > 1000);
    assert.equal(native.mimeType, "text/html;profile=mcp-app");

    const gpt = widgetHtmlByPublicPath("portfolio-gpt.html");
    assert.ok(gpt);
    assert.equal(gpt.uri, "ui://aichart/portfolio-gpt.html");
    assert.equal(gpt.mimeType, "text/html+skybridge");
  });
});

describe("structured tool text fallback", () => {
  it("formats account overview as readable Arabic text", () => {
    const text = formatToolTextFallback({
      risk: { perTradeMaxUsd: 250, status: "ok" },
      portfolio: { account: { balance: 1000, equity: 1050 }, openPnl: 12.5 },
      live: { forex: { ea: { heartbeatFresh: true, online: true } } },
    });
    assert.ok(text?.includes("حالة الحساب"));
    assert.ok(text?.includes("إعداد حد الصفقة"));
    assert.ok(text?.includes("250"));
  });

  it("marks stale EA open PnL as unavailable", () => {
    const text = formatToolTextFallback({
      risk: {},
      portfolio: { openPnl: 0 },
      live: { forex: { ea: { heartbeatFresh: false, online: false } } },
    });
    assert.ok(text?.includes("— / بيانات قديمة"));
  });

  it("formatBridgeResult uses readable fallback when structured", () => {
    const out = formatBridgeResult(
      { snapshot: { symbol: "EURUSD", price: 1.08, rsi14: 55, trend: "bullish" } },
      { structured: true },
    );
    assert.ok(out.structuredContent);
    assert.ok(out.content[0]?.text.includes("EURUSD"));
    assert.ok(!out.content[0]?.text.startsWith("{"));
  });
});

describe("widget HTML safety", () => {
  it("contains no direct fetch calls in inline widget HTML", () => {
    for (const [name, html] of Object.entries(WIDGETS) as [string, string][]) {
      assert.ok(!html.includes("fetch("), `${name} must not call fetch()`);
    }
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
