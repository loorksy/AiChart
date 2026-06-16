import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { BridgeClient } from "../bridge/client.js";
import { bridgeCall, bridgeWrap } from "./helpers.js";

export function registerMarketTools(server: McpServer, bridge: BridgeClient) {
  server.registerTool(
    "get_market_snapshot",
    {
      description: "لقطة فنية حية: سعر، RSI، MACD، SMA، اتجاه.",
      inputSchema: {
        symbol: z.string().describe("مثل BTCUSDT"),
        interval: z.string().optional().describe("1h, 4h, 1d…"),
        market: z.enum(["crypto", "forex"]).optional(),
      },
    },
    async ({ symbol, interval, market }) =>
      bridgeCall(() =>
        bridge.get("/api/agent/market/snapshot", {
          symbol,
          interval,
          market,
        }),
      ),
  );

  server.registerTool(
    "get_market_price",
    {
      description: "السعر اللحظي لزوج.",
      inputSchema: {
        symbol: z.string(),
        market: z.enum(["crypto", "forex"]).optional(),
      },
    },
    async ({ symbol, market }) =>
      bridgeCall(() =>
        bridge.get("/api/agent/market/price", { symbol, market }),
      ),
  );

  server.registerTool(
    "get_market_context",
    {
      description: "سياق السوق: أخبار، fear & greed، مزاج.",
      inputSchema: {
        symbol: z.string(),
        interval: z.string().optional(),
      },
    },
    async ({ symbol, interval }) =>
      bridgeCall(() =>
        bridge.get("/api/agent/market/context", { symbol, interval }),
      ),
  );

  server.registerTool(
    "scan_market",
    {
      description:
        "مسح فرص فنية على عدة رموز (كود فقط). استخدم عند «خذ صفقة» لمقارنة BTC/ETH/… قبل اختيار الزوج.",
      inputSchema: {
        symbols: z.array(z.string()).max(30).optional(),
        interval: z.string().optional(),
        market: z.enum(["crypto", "forex"]).optional(),
      },
    },
    async (body) =>
      bridgeCall(() => bridge.post("/api/agent/market/scan", body)),
  );
}
