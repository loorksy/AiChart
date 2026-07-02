import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BridgeClient } from "../bridge/client.js";
import { bridgeCall } from "./helpers.js";
import { mcpToolConfig } from "./schemas/index.js";

export function registerMarketTools(server: McpServer, bridge: BridgeClient) {
  server.registerTool(
    "get_market_snapshot",
    mcpToolConfig("get_market_snapshot"),
    async (args) => {
      const { symbol, interval, market } = args as {
        symbol: string;
        interval?: string;
        market?: "crypto" | "forex";
      };
      return bridgeCall(() =>
        bridge.get("/api/agent/market/snapshot", { symbol, interval, market }),
      );
    },
  );

  server.registerTool(
    "get_multi_timeframe_snapshot",
    mcpToolConfig("get_multi_timeframe_snapshot"),
    async (args) => {
      const { symbol, intervals, market } = args as {
        symbol: string;
        intervals?: string[];
        market?: "crypto" | "forex";
      };
      return bridgeCall(() =>
        bridge.get(
          "/api/agent/market/multi-snapshot",
          {
            symbol,
            intervals: intervals?.length ? intervals.join(",") : undefined,
            market,
          },
          // Forex frames serialize on the single-threaded EA (~2-3s each);
          // allow up to 25s so 3-5 timeframes complete instead of 504-ing.
          25000,
        ),
      );
    },
  );

  server.registerTool(
    "get_market_price",
    mcpToolConfig("get_market_price"),
    async (args) => {
      const { symbol, market } = args as {
        symbol: string;
        market?: "crypto" | "forex";
      };
      return bridgeCall(() =>
        bridge.get("/api/agent/market/price", { symbol, market }),
      );
    },
  );

  server.registerTool(
    "list_instruments",
    mcpToolConfig("list_instruments"),
    async (args) => {
      const { market, q } = args as {
        market?: "crypto" | "forex";
        q?: string;
      };
      // Public instruments endpoint (OANDA forex / Binance crypto universe).
      return bridgeCall(() =>
        bridge.get("/api/instruments", {
          market: market ?? "forex",
          q,
          wrapped: "1",
        }),
      );
    },
  );

  server.registerTool(
    "get_chart_link",
    mcpToolConfig("get_chart_link"),
    async (args) => {
      const { symbol } = args as { symbol: string };
      const sym = symbol.toUpperCase().replace(/[^A-Z0-9.]/g, "");
      const base = process.env.AICHART_PUBLIC_URL ?? "https://aichart.lork.cloud";
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ symbol: sym, url: `${base}/chart/${sym}` }),
          },
        ],
      };
    },
  );

  server.registerTool(
    "get_market_context",
    mcpToolConfig("get_market_context"),
    async (args) => {
      const { symbol, interval } = args as {
        symbol: string;
        interval?: string;
      };
      return bridgeCall(() =>
        bridge.get("/api/agent/market/context", { symbol, interval }),
      );
    },
  );

  server.registerTool(
    "scan_market",
    mcpToolConfig("scan_market"),
    async (body) => bridgeCall(() => bridge.post("/api/agent/market/scan", body)),
  );

  server.registerTool(
    "get_ohlc",
    mcpToolConfig("get_ohlc"),
    async (args) => {
      const { symbol, interval, market, limit, cursor } = args as {
        symbol: string;
        interval?: string;
        market?: "crypto" | "forex";
        limit?: number;
        cursor?: number;
      };
      return bridgeCall(() =>
        bridge.get("/api/agent/market/ohlc", {
          symbol,
          interval,
          market,
          limit,
          cursor,
        }),
      );
    },
  );

  server.registerTool(
    "get_forex_indicators",
    mcpToolConfig("get_forex_indicators"),
    async (args) => {
      const { symbol, interval, market } = args as {
        symbol: string;
        interval?: string;
        market?: "crypto" | "forex";
      };
      return bridgeCall(() =>
        bridge.get("/api/agent/market/forex-indicators", {
          symbol,
          interval,
          market,
        }),
      );
    },
  );

  server.registerTool(
    "detect_levels",
    mcpToolConfig("detect_levels"),
    async (args) => {
      const { symbol, interval, market, limit } = args as {
        symbol: string;
        interval?: string;
        market?: "crypto" | "forex";
        limit?: number;
      };
      return bridgeCall(() =>
        bridge.get("/api/agent/market/detect-levels", {
          symbol,
          interval,
          market,
          limit,
        }),
      );
    },
  );
}
