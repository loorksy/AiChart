import test from "node:test";
import assert from "node:assert/strict";
import {
  buildOdysseusChartEmbedUrl,
  buildOdysseusIntegrationManifest,
} from "../integrations/odysseus";

test("builds a sanitized Odysseus chart embed URL", () => {
  const url = buildOdysseusChartEmbedUrl(
    {
      symbol: "eur/usd<script>",
      interval: "4h",
      source: "ea",
      conversationId: "conv-1",
      recommendationId: "rec-1",
    },
    "https://example.test",
  );

  assert.equal(
    url,
    "https://example.test/integrations/odysseus/embed?symbol=EURUSD&interval=4h&source=ea&conversationId=conv-1&recommendationId=rec-1",
  );
});

test("manifest advertises the chat trading capabilities Odysseus needs", () => {
  const manifest = buildOdysseusIntegrationManifest("https://example.test");

  assert.equal(manifest.name, "AiChart Trading Workspace for Odysseus");
  assert.equal(manifest.capabilities.chatEmbeddedChart, true);
  assert.equal(manifest.capabilities.oandaServerSideMarketData, true);
  assert.deepEqual(manifest.capabilities.modes, ["manual", "semi_auto", "full_auto"]);
  assert.ok(manifest.tools.some((tool) => tool.name === "execute_mt5_order"));
  assert.ok(manifest.tools.some((tool) => tool.name === "get_mt5_status"));
  assert.ok(manifest.tools.some((tool) => tool.name === "set_trading_mode"));
  assert.equal(manifest.defaultChart.embedUrl, "https://example.test/integrations/odysseus/embed?symbol=EURUSD&interval=15m&source=oanda");
});
