import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { BridgeClient } from "../bridge/client.js";
import { bridgeCall, bridgeWrap } from "./helpers.js";
import { READ_ONLY, withAnnotations } from "./registry.js";

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

  server.registerTool(
    "get_ohlc",
    {
      description:
        "شموع OHLC — فوركس via EA get_ohlc، كريبتو via Binance. متى: قبل get_forex_indicators أو detect_levels. لا side-effects. cursor/limit للترقيم (حد 500). مثال: symbol=EURUSD&interval=1h&limit=100&market=forex.",
      inputSchema: {
        symbol: z.string().describe("مثل EURUSD أو BTCUSDT"),
        interval: z.string().optional().describe("1h, 4h, 1d…"),
        market: z.enum(["crypto", "forex"]).optional(),
        limit: z.number().int().min(1).max(500).optional(),
        cursor: z
          .number()
          .int()
          .optional()
          .describe("وقت ms — شموع أقدم (crypto pagination)"),
      },
      ...withAnnotations(READ_ONLY),
    },
    async ({ symbol, interval, market, limit, cursor }) =>
      bridgeCall(() =>
        bridge.get("/api/agent/market/ohlc", {
          symbol,
          interval,
          market,
          limit,
          cursor,
        }),
      ),
  );

  server.registerTool(
    "get_forex_indicators",
    {
      description:
        "مؤشرات RSI/MACD/SMA/EMA/Bollinger/ATR/Stoch + trend من OHLC. متى: بعد get_ohlc أو مع symbol حي. لا تستخدم بدون symbol أو مع quote قديم. read-only. مثال: symbol=EURUSD&interval=1h&market=forex.",
      inputSchema: {
        symbol: z.string(),
        interval: z.string().optional(),
        market: z.enum(["crypto", "forex"]).optional(),
      },
      ...withAnnotations(READ_ONLY),
    },
    async ({ symbol, interval, market }) =>
      bridgeCall(() =>
        bridge.get("/api/agent/market/forex-indicators", {
          symbol,
          interval,
          market,
        }),
      ),
  );

  server.registerTool(
    "detect_levels",
    {
      description:
        "دعم/مقاومة من swing highs/lows + بنية السوق. متى: قبل وضع SL/TP. لا تستخدم كإشارة دخول وحيدة. read-only. مثال: symbol=EURUSD&interval=4h&limit=120.",
      inputSchema: {
        symbol: z.string(),
        interval: z.string().optional(),
        market: z.enum(["crypto", "forex"]).optional(),
        limit: z.number().int().min(20).max(500).optional(),
      },
      ...withAnnotations(READ_ONLY),
    },
    async ({ symbol, interval, market, limit }) =>
      bridgeCall(() =>
        bridge.get("/api/agent/market/detect-levels", {
          symbol,
          interval,
          market,
          limit,
        }),
      ),
  );
}
