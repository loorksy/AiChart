import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BridgeClient } from "../bridge/client.js";
import { bridgeCall, bridgeWrap } from "./helpers.js";
import { mcpToolConfig } from "./schemas/index.js";
import {
  resolveChartSnapshotResponse,
  type ChartSnapshotBridgeResult,
} from "./chartInline.js";

export function registerMt5Tools(server: McpServer, bridge: BridgeClient) {
  server.registerTool(
    "connect_mt5",
    mcpToolConfig("connect_mt5"),
    async (body) =>
      bridgeCall("connect_mt5", body as Record<string, unknown>, () =>
        bridge.post("/api/agent/mt/connect", body),
      ),
  );

  server.registerTool(
    "disconnect_mt5",
    mcpToolConfig("disconnect_mt5"),
    bridgeWrap("disconnect_mt5", bridge, () => bridge.delete("/api/agent/mt/connect")),
  );

  server.registerTool(
    "get_mt5_status",
    mcpToolConfig("get_mt5_status"),
    bridgeWrap("get_mt5_status", bridge, () => bridge.get("/api/agent/mt/status")),
  );

  server.registerTool(
    "get_live_account",
    mcpToolConfig("get_live_account"),
    // structured:true fixes a Phase 0 finding: this payload matches
    // isAccountOverview() but bridgeWrap never opted into the text fallback.
    async () =>
      bridgeCall("get_live_account", {}, () => bridge.get("/api/agent/live/account"), {
        structured: true,
      }),
  );

  server.registerTool(
    "get_account_symbols",
    mcpToolConfig("get_account_symbols"),
    async (args) => {
      const { q, market, limit } = args as {
        q?: string;
        market?: string;
        limit?: number;
      };
      return bridgeCall("get_account_symbols", args as Record<string, unknown>, () =>
        bridge.get("/api/agent/mt/symbols", { q, market, limit }),
      );
    },
  );

  server.registerTool(
    "capture_mt5_chart",
    mcpToolConfig("capture_mt5_chart"),
    async (rawBody) => {
      const { inline_image: inlineImageRaw, ...body } = (rawBody ?? {}) as Record<
        string,
        unknown
      > & { inline_image?: boolean };
      const inlineOpts = { inlineImage: inlineImageRaw !== false };
      const input = body as {
        symbol: string;
        interval?: string;
        recommendation_id?: number;
        capture_key?: string;
        entry?: number;
        stop_loss?: number;
        take_profit?: number;
        drawings?: Record<string, unknown>[];
      };

      const snapRes = (await bridge.post("/api/agent/chart/snapshot", {
        symbol: input.symbol,
        interval: input.interval ?? "1h",
        market: "forex",
        response_format: "json",
        chart_drawings: input.drawings,
        pattern_name: null,
      })) as ChartSnapshotBridgeResult;
      return resolveChartSnapshotResponse(
        bridge,
        snapRes,
        undefined,
        {
          tool: "capture_mt5_chart",
          symbol: input.symbol,
          timeframe: input.interval,
        },
        inlineOpts,
      );
    },
  );

  server.registerTool(
    "modify_sl_tp",
    mcpToolConfig("modify_sl_tp"),
    async (body) =>
      bridgeCall("modify_sl_tp", body as Record<string, unknown>, () =>
        bridge.post("/api/agent/mt/modify-sl-tp", body),
      ),
  );

  server.registerTool(
    "cancel_mt5_order",
    mcpToolConfig("cancel_mt5_order"),
    async (body) =>
      bridgeCall("cancel_mt5_order", body as Record<string, unknown>, () =>
        bridge.post("/api/agent/mt/cancel-order", body),
      ),
  );

  server.registerTool(
    "close_partial",
    mcpToolConfig("close_partial"),
    async (body) =>
      bridgeCall("close_partial", body as Record<string, unknown>, () =>
        bridge.post("/api/agent/mt/close-partial", body),
      ),
  );

  server.registerTool(
    "get_position",
    mcpToolConfig("get_position"),
    async (args) => {
      const { position_id } = args as { position_id: string };
      return bridgeCall("get_position", args as Record<string, unknown>, () =>
        bridge.get("/api/agent/mt/position", { position_id }),
      );
    },
  );

  server.registerTool(
    "get_order",
    mcpToolConfig("get_order"),
    async (args) => {
      const { order_id } = args as { order_id: string };
      return bridgeCall("get_order", args as Record<string, unknown>, () =>
        bridge.get("/api/agent/mt/order", { order_id }),
      );
    },
  );

  server.registerTool(
    "get_orders",
    mcpToolConfig("get_orders"),
    bridgeWrap("get_orders", bridge, () => bridge.get("/api/agent/mt/orders")),
  );

  server.registerTool(
    "get_history_orders",
    mcpToolConfig("get_history_orders"),
    async (args) => {
      const params = (args ?? {}) as Record<string, string | number | undefined>;
      return bridgeCall("get_history_orders", params, () =>
        bridge.get("/api/agent/mt/history-orders", params),
      );
    },
  );

  server.registerTool(
    "get_deals",
    mcpToolConfig("get_deals"),
    async (args) => {
      const params = (args ?? {}) as Record<string, string | number | undefined>;
      return bridgeCall("get_deals", params, () =>
        bridge.get("/api/agent/mt/deals", params),
      );
    },
  );

  server.registerTool(
    "get_server_time",
    mcpToolConfig("get_server_time"),
    bridgeWrap("get_server_time", bridge, () => bridge.get("/api/agent/mt/server-time")),
  );

  server.registerTool(
    "calculate_margin",
    mcpToolConfig("calculate_margin"),
    async (body) =>
      bridgeCall("calculate_margin", body as Record<string, unknown>, () =>
        bridge.post("/api/agent/mt/margin", body),
      ),
  );

  server.registerTool(
    "get_current_tick",
    mcpToolConfig("get_current_tick"),
    async (args) => {
      const { symbol } = args as { symbol: string };
      return bridgeCall("get_current_tick", args as Record<string, unknown>, () =>
        bridge.get("/api/agent/mt/tick", { symbol }),
      );
    },
  );

  server.registerTool(
    "propose_modify_order",
    mcpToolConfig("propose_modify_order"),
    async (body) =>
      bridgeCall("propose_modify_order", body as Record<string, unknown>, () =>
        bridge.post("/api/agent/mt/propose-modify-order", body),
      ),
  );

  server.registerTool(
    "propose_cancel_order",
    mcpToolConfig("propose_cancel_order"),
    async (body) =>
      bridgeCall("propose_cancel_order", body as Record<string, unknown>, () =>
        bridge.post("/api/agent/mt/propose-cancel-order", body),
      ),
  );

  server.registerTool(
    "propose_close_position_by_symbol",
    mcpToolConfig("propose_close_position_by_symbol"),
    async (body) =>
      bridgeCall("propose_close_position_by_symbol", body as Record<string, unknown>, () =>
        bridge.post("/api/agent/mt/propose-close-by-symbol", body),
      ),
  );
}
