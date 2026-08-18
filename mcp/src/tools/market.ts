import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BridgeClient } from "../bridge/client.js";
import { bridgeCall } from "./helpers.js";
import { mcpToolConfig } from "./schemas/index.js";

/**
 * Pass the symbol through as the caller spelled it.
 *
 * The web bridge serves every user from the platform OANDA feed.
 * Folding every symbol through toCanonicalForexSymbol here forced
 * XAUUSDm → XAUUSD and then asked the feed for an instrument that does not
 * exist — and hid which book the numbers came from.
 */
function bridgeSymbol(symbol: string): string {
  return symbol.trim();
}

export function registerMarketTools(server: McpServer, bridge: BridgeClient) {
  server.registerTool(
    "get_market_snapshot",
    mcpToolConfig("get_market_snapshot"),
    async (args) => {
      const { symbol, interval, market } = args as {
        symbol: string;
        interval?: string;
        market?: "forex";
      };
      return bridgeCall(
        "get_market_snapshot",
        args as Record<string, unknown>,
        () =>
          bridge.get("/api/agent/market/snapshot", {
            symbol: bridgeSymbol(symbol),
            interval,
            market: market ?? "forex",
          }),
        { structured: true },
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
        market?: "forex";
      };
      return bridgeCall(
        "get_multi_timeframe_snapshot",
        args as Record<string, unknown>,
        () =>
          bridge.get(
            "/api/agent/market/multi-snapshot",
            {
              symbol: bridgeSymbol(symbol),
              intervals: intervals?.length ? intervals.join(",") : undefined,
              market: market ?? "forex",
            },
            25000,
          ),
        { structured: true },
      );
    },
  );

  server.registerTool(
    "get_market_price",
    mcpToolConfig("get_market_price"),
    async (args) => {
      const { symbol, market } = args as {
        symbol: string;
        market?: "forex";
      };
      return bridgeCall("get_market_price", args as Record<string, unknown>, () =>
        bridge.get("/api/agent/market/price", {
          symbol: bridgeSymbol(symbol),
          market: market ?? "forex",
        }),
      );
    },
  );

  server.registerTool(
    "list_instruments",
    mcpToolConfig("list_instruments"),
    async (args) => {
      const { market, q } = args as {
        market?: "forex";
        q?: string;
      };
      return bridgeCall("list_instruments", args as Record<string, unknown>, () =>
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
      // Preserve broker case in the deep link — the chart URL accepts it.
      const sym = symbol.trim().replace(/[^A-Za-z0-9._]/g, "");
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
      return bridgeCall("get_market_context", args as Record<string, unknown>, () =>
        bridge.get("/api/agent/market/context", {
          symbol: bridgeSymbol(symbol),
          interval,
        }),
      );
    },
  );

  server.registerTool(
    "scan_market",
    mcpToolConfig("scan_market"),
    async (body) =>
      bridgeCall("scan_market", body as Record<string, unknown>, () =>
        bridge.post("/api/agent/market/scan", body),
      ),
  );

  server.registerTool(
    "get_ohlc",
    mcpToolConfig("get_ohlc"),
    async (args) => {
      const { symbol, interval, market, limit, cursor } = args as {
        symbol: string;
        interval?: string;
        market?: "forex";
        limit?: number;
        cursor?: number;
      };
      // No source override — the bridge reads the platform OANDA feed
      // and returns `source`/`book` on the result.
      return bridgeCall("get_ohlc", args as Record<string, unknown>, () =>
        bridge.get("/api/agent/market/ohlc", {
          symbol: bridgeSymbol(symbol),
          interval,
          market: market ?? "forex",
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
        market?: "forex";
      };
      return bridgeCall("get_forex_indicators", args as Record<string, unknown>, () =>
        bridge.get("/api/agent/market/forex-indicators", {
          symbol: bridgeSymbol(symbol),
          interval,
          market: market ?? "forex",
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
        market?: "forex";
        limit?: number;
      };
      return bridgeCall("detect_levels", args as Record<string, unknown>, () =>
        bridge.get("/api/agent/market/detect-levels", {
          symbol: bridgeSymbol(symbol),
          interval,
          market: market ?? "forex",
          limit,
        }),
      );
    },
  );

  server.registerTool(
    "detect_market_regime",
    mcpToolConfig("detect_market_regime"),
    async (args) => {
      const { symbol, interval, market, limit } = args as {
        symbol: string;
        interval?: string;
        market?: "forex";
        limit?: number;
      };
      return bridgeCall("detect_market_regime", args as Record<string, unknown>, () =>
        bridge.get("/api/agent/market/detect-regime", {
          symbol: bridgeSymbol(symbol),
          interval,
          market: market ?? "forex",
          limit,
        }),
      );
    },
  );
}
