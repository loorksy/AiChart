import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildOdysseusEmbedUrl,
  buildOdysseusManifest,
  buildOdysseusToolDescriptors,
  sanitizeOdysseusInterval,
  sanitizeOdysseusSource,
  sanitizeOdysseusSymbol,
} from "../integrations/odysseus";

describe("odysseus integration manifest", () => {
  it("declares chat embed and forex bridge capabilities", () => {
    const manifest = buildOdysseusManifest("https://chart.example.com");
    assert.equal(manifest.integration, "odysseus");
    assert.equal(manifest.host, "aichart");
    assert.equal(manifest.capabilities.chatEmbeddedChart, true);
    assert.equal(manifest.capabilities.oandaServerSideMarketData, true);
    assert.equal(manifest.capabilities.mt5EaExecutionBridge, true);
    assert.equal(manifest.capabilities.internalBacktesting, "planned");
    assert.equal(manifest.tradingModes.length, 3);
    assert.ok(manifest.endpoints.embed.includes("/integrations/odysseus/embed"));
  });

  it("lists trading tool descriptors without secrets", () => {
    const tools = buildOdysseusToolDescriptors();
    const names = tools.map((t) => t.name);
    assert.ok(names.includes("open_chart"));
    assert.ok(names.includes("analyze_market"));
    assert.ok(names.includes("execute_mt5_order"));
    assert.ok(names.includes("emergency_stop"));
    assert.ok(names.includes("set_trading_mode"));
    for (const tool of tools) {
      assert.ok(tool.bridgePath.startsWith("/api/"));
      assert.match(JSON.stringify(tool), /^(?!.*SERVICE_TOKEN).*$/);
    }
  });

  it("sanitizes embed params", () => {
    assert.equal(sanitizeOdysseusSymbol("eur/usd"), "EURUSD");
    assert.equal(sanitizeOdysseusInterval("99x"), "15m");
    assert.equal(sanitizeOdysseusSource("ea"), "ea");
    assert.equal(sanitizeOdysseusSource("binance"), "oanda");
    const url = buildOdysseusEmbedUrl({
      baseUrl: "https://chart.example.com",
      symbol: "GBPUSD",
      interval: "1h",
      readonlyAgentDrawings: true,
    });
    assert.match(url, /symbol=GBPUSD/);
    assert.match(url, /readonlyAgentDrawings=1/);
  });
});
