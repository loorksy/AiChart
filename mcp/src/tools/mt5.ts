import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BridgeClient } from "../bridge/client.js";
import { formatBridgeError } from "../bridge/client.js";
import { bridgeCall, bridgeWrap } from "./helpers.js";
import { mcpToolConfig } from "./schemas/index.js";
import {
  chartInlineContent,
  chartTimeoutContent,
  DRAW_CAPTURE_MAX_MS,
  mt5ChartPollId,
  pollBridgeMt5ChartPng,
  resolveChartSnapshotResponse,
  type ChartSnapshotBridgeResult,
} from "./chartInline.js";

export function registerMt5Tools(server: McpServer, bridge: BridgeClient) {
  server.registerTool(
    "connect_mt5",
    mcpToolConfig("connect_mt5"),
    async (body) =>
      bridgeCall(() => bridge.post("/api/agent/mt/connect", body)),
  );

  server.registerTool(
    "disconnect_mt5",
    mcpToolConfig("disconnect_mt5"),
    bridgeWrap(bridge, () => bridge.delete("/api/agent/mt/connect")),
  );

  server.registerTool(
    "get_mt5_status",
    mcpToolConfig("get_mt5_status"),
    bridgeWrap(bridge, () => bridge.get("/api/agent/mt/status")),
  );

  server.registerTool(
    "get_live_account",
    mcpToolConfig("get_live_account"),
    bridgeWrap(bridge, () => bridge.get("/api/agent/live/account")),
  );

  server.registerTool(
    "get_ea_diagnostics",
    mcpToolConfig("get_ea_diagnostics"),
    async ({ symbol }: { symbol?: string }) =>
      bridgeCall(() =>
        bridge.get("/api/agent/ea/diagnostics", symbol ? { symbol } : {}),
      ),
  );

  server.registerTool(
    "get_ea_live_quotes",
    mcpToolConfig("get_ea_live_quotes"),
    async ({ symbol }: { symbol?: string }) =>
      bridgeCall(() =>
        bridge.get("/api/agent/ea/live-quotes", symbol ? { symbol } : {}),
      ),
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
      return bridgeCall(() =>
        bridge.get("/api/agent/ea/symbols", { q, market, limit }),
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
      const inlineOpts = { inlineImage: inlineImageRaw === true };
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

      const hasAnnotations =
        input.entry != null ||
        input.stop_loss != null ||
        input.take_profit != null ||
        (Array.isArray(input.drawings) && input.drawings.length > 0) ||
        input.recommendation_id != null;

      if (!hasAnnotations) {
        try {
          const snapRes = (await bridge.post("/api/agent/chart/snapshot", {
            symbol: input.symbol,
            interval: input.interval ?? "1h",
            market: "forex",
            response_format: "json",
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
        } catch (e) {
          return formatBridgeError(e);
        }
      }

      try {
        const queued = (await bridge.post(
          "/api/agent/ea/chart-capture",
          body,
        )) as {
          queued?: boolean;
          chartUrl?: string;
          captureKey?: string;
          reason?: string;
        };

        if (!queued.queued) {
          return {
            content: [
              { type: "text", text: JSON.stringify(queued, null, 2) },
            ],
          };
        }

        const chartId = mt5ChartPollId(
          queued.chartUrl,
          queued.captureKey ?? input.capture_key,
          input.recommendation_id,
        );
        if (!chartId) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    ...queued,
                    status: "pending",
                    message: "Chart queued but poll id missing.",
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        }

        const polled = await pollBridgeMt5ChartPng(bridge, chartId, {
          maxMs: DRAW_CAPTURE_MAX_MS,
          intervalMs: 500,
        });
        if ("timeout" in polled) {
          return chartTimeoutContent(
            { chartUrl: queued.chartUrl, captureKey: chartId },
            polled.retryAfterMs,
          );
        }

        return chartInlineContent(
          {
            ok: true,
            queued: true,
            chartUrl: queued.chartUrl,
            captureKey: chartId,
            mt5Symbol: (queued as { mt5Symbol?: string }).mt5Symbol,
            image_source: "mt5",
          },
          polled.png,
          {
            tool: "capture_mt5_chart",
            symbol: input.symbol,
            timeframe: input.interval,
          },
          inlineOpts,
        );
      } catch (e) {
        return formatBridgeError(e);
      }
    },
  );

  server.registerTool(
    "modify_sl_tp",
    mcpToolConfig("modify_sl_tp"),
    async (body) =>
      bridgeCall(() => bridge.post("/api/agent/ea/modify-sl-tp", body)),
  );

  server.registerTool(
    "cancel_mt5_order",
    mcpToolConfig("cancel_mt5_order"),
    async (body) =>
      bridgeCall(() => bridge.post("/api/agent/ea/cancel-order", body)),
  );

  server.registerTool(
    "close_partial",
    mcpToolConfig("close_partial"),
    async (body) =>
      bridgeCall(() => bridge.post("/api/agent/ea/close-partial", body)),
  );

  server.registerTool(
    "query_mt5_terminal",
    mcpToolConfig("query_mt5_terminal"),
    bridgeWrap(bridge, () => bridge.get("/api/agent/ea/query-terminal")),
  );

  server.registerTool(
    "request_ea_reconnect",
    mcpToolConfig("request_ea_reconnect"),
    async (body) =>
      bridgeCall(() => bridge.post("/api/agent/ea/reconnect", body)),
  );
}
