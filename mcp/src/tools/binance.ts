import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BridgeClient } from "../bridge/client.js";
import { bridgeCall } from "./helpers.js";
import { mcpToolConfig } from "./schemas/index.js";

export function registerBinanceTools(server: McpServer, bridge: BridgeClient) {
  server.registerTool(
    "connect_binance",
    mcpToolConfig("connect_binance"),
    async (body) =>
      bridgeCall(() => bridge.post("/api/agent/binance/connect", body)),
  );

  server.registerTool(
    "verify_binance",
    mcpToolConfig("verify_binance"),
    async (body) =>
      bridgeCall(() =>
        bridge.post("/api/agent/binance/connect", {
          ...body,
          verify_only: true,
        }),
      ),
  );

  server.registerTool(
    "get_binance_status",
    mcpToolConfig("get_binance_status"),
    async ({ futuresRequired }) =>
      bridgeCall(() =>
        bridge.get("/api/agent/binance/connect", {
          futuresRequired: futuresRequired ? "1" : undefined,
        }),
      ),
  );

  server.registerTool(
    "disconnect_binance",
    mcpToolConfig("disconnect_binance"),
    async ({ env }) => {
      const query = env ? `?env=${env}` : "";
      return bridgeCall(() => bridge.delete(`/api/agent/binance${query}`));
    },
  );

  server.registerTool(
    "capture_binance_chart",
    mcpToolConfig("capture_binance_chart"),
    async (body) =>
      bridgeCall(() => bridge.post("/api/agent/chart/binance-capture", body)),
  );

  server.registerTool(
    "get_futures_positions",
    mcpToolConfig("get_futures_positions"),
    async ({ symbol }: { symbol?: string }) =>
      bridgeCall(() =>
        bridge.get("/api/agent/futures/positions", symbol ? { symbol } : {}),
      ),
  );

  server.registerTool(
    "get_futures_orders",
    mcpToolConfig("get_futures_orders"),
    async ({ symbol }: { symbol?: string }) =>
      bridgeCall(() =>
        bridge.get("/api/agent/futures/orders", symbol ? { symbol } : {}),
      ),
  );

  server.registerTool(
    "modify_futures_sl_tp",
    mcpToolConfig("modify_futures_sl_tp"),
    async (body) =>
      bridgeCall(() => bridge.post("/api/agent/futures/modify", body)),
  );

  server.registerTool(
    "cancel_futures_order",
    mcpToolConfig("cancel_futures_order"),
    async (body) =>
      bridgeCall(() => bridge.delete("/api/agent/futures/orders", body)),
  );
}
