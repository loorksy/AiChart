import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BridgeClient } from "../bridge/client.js";
import { BridgeError, formatBridgeError } from "../bridge/client.js";
import { bridgeCall, bridgeWrap } from "./helpers.js";
import { MCP_SERVER_VERSION } from "./registry.js";
import { mcpToolConfig } from "./schemas/index.js";
import {
  chartInlineContent,
  chartTimeoutContent,
  pollBridgeMt5ChartPng,
  resolveChartSnapshotResponse,
  type ChartSnapshotBridgeResult,
} from "./chartInline.js";

export function registerCoreTools(server: McpServer, bridge: BridgeClient) {
  server.registerTool(
    "get_account_overview",
    mcpToolConfig("get_account_overview"),
    async (args) => {
      const { include_live = true } = (args ?? {}) as {
        include_live?: boolean;
      };
      return bridgeCall(async () => {
        // allSettled so a slow/failing live account never sinks the whole
        // overview — risk + portfolio still return. live gets a bounded 10s.
        const settled = await Promise.allSettled([
          bridge.get("/api/agent/risk/status"),
          bridge.get("/api/agent/portfolio"),
          include_live
            ? bridge.get("/api/agent/live/account", undefined, 10000)
            : Promise.resolve({ skipped: true }),
        ]);
        const val = (r: PromiseSettledResult<unknown>) =>
          r.status === "fulfilled"
            ? r.value
            : {
                error:
                  r.reason instanceof Error
                    ? r.reason.message
                    : String(r.reason),
              };
        return {
          risk: val(settled[0]),
          portfolio: val(settled[1]),
          live: include_live ? val(settled[2]) : { skipped: true },
        };
      });
    },
  );

  server.registerTool(
    "get_risk_status",
    mcpToolConfig("get_risk_status"),
    bridgeWrap(bridge, () => bridge.get("/api/agent/risk/status")),
  );

  server.registerTool(
    "get_trade_readiness",
    mcpToolConfig("get_trade_readiness"),
    async (args) => {
      const { symbol, market, confidence, practice } = args as {
        symbol?: string;
        market?: "crypto" | "forex";
        confidence?: number;
        practice?: boolean;
      };
      return bridgeCall(() =>
        bridge.get("/api/agent/trade/readiness", {
          symbol,
          market,
          confidence,
          practice: practice ? "true" : undefined,
        }),
      );
    },
  );

  server.registerTool(
    "get_agent_capabilities",
    mcpToolConfig("get_agent_capabilities"),
    async () => {
      try {
        const raw = await bridge.get("/api/agent/model");
        // Defence-in-depth: strip any field whose value looks like an API key,
        // even if the bridge endpoint already sanitised it.
        const sanitize = (obj: unknown): unknown => {
          if (typeof obj !== "object" || obj === null) return obj;
          const out: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
            // Drop legacy providerKeys or any field carrying a raw key value.
            if (k === "providerKeys") continue;
            if (typeof v === "string" && /^(sk-|AIza|sk-ant-|sk-or-)/.test(v)) continue;
            out[k] = typeof v === "object" ? sanitize(v) : v;
          }
          return out;
        };
        const model = sanitize(raw);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  ...(typeof model === "object" && model !== null ? model : {}),
                  mcpServerVersion: MCP_SERVER_VERSION,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (e) {
        return formatBridgeError(e);
      }
    },
  );

  server.registerTool(
    "get_portfolio",
    mcpToolConfig("get_portfolio"),
    bridgeWrap(bridge, () => bridge.get("/api/agent/portfolio")),
  );

  server.registerTool(
    "get_open_trades",
    mcpToolConfig("get_open_trades"),
    bridgeWrap(bridge, () => bridge.get("/api/agent/trades/open")),
  );

  server.registerTool(
    "get_trade_lessons",
    mcpToolConfig("get_trade_lessons"),
    async (args) => {
      const { symbol, pattern, limit, recent } = args as {
        symbol?: string;
        pattern?: string;
        limit?: number;
        recent?: boolean;
      };
      return bridgeCall(() =>
        bridge.get("/api/agent/memory/lessons", {
          symbol,
          pattern,
          limit,
          ...(recent ? { recent: "1" } : {}),
        }),
      );
    },
  );

  server.registerTool(
    "create_recommendation",
    mcpToolConfig("create_recommendation"),
    async (body) =>
      bridgeCall(() => bridge.post("/api/agent/recommendation", body)),
  );

  server.registerTool(
    "open_trade",
    mcpToolConfig("open_trade"),
    async (body) => bridgeCall(() => bridge.post("/api/agent/trade/open", body)),
  );

  server.registerTool(
    "close_trade",
    mcpToolConfig("close_trade"),
    async (body) => bridgeCall(() => bridge.post("/api/agent/trade/close", body)),
  );

  server.registerTool(
    "evaluate_trade",
    mcpToolConfig("evaluate_trade"),
    async (args) => {
      const { trade_id } = args as { trade_id: number };
      return bridgeCall(() =>
        bridge.get("/api/agent/trade/evaluate", { trade_id }),
      );
    },
  );

  server.registerTool(
    "record_exit_decision",
    mcpToolConfig("record_exit_decision"),
    async (body) =>
      bridgeCall(() => bridge.post("/api/agent/trade/exit-decision", body)),
  );

  server.registerTool(
    "request_approval",
    mcpToolConfig("request_approval"),
    async (body) =>
      bridgeCall(() => bridge.post("/api/agent/approval/request", body)),
  );

  server.registerTool(
    "respond_approval",
    mcpToolConfig("respond_approval"),
    async (body) =>
      bridgeCall(() => bridge.post("/api/agent/approval/respond", body)),
  );

  server.registerTool(
    "get_pending_approvals",
    mcpToolConfig("get_pending_approvals"),
    bridgeWrap(bridge, () => bridge.get("/api/agent/approval/pending")),
  );

  server.registerTool(
    "get_execution_env",
    mcpToolConfig("get_execution_env"),
    bridgeWrap(bridge, () => bridge.get("/api/agent/execution/env")),
  );

  server.registerTool(
    "set_execution_env",
    mcpToolConfig("set_execution_env"),
    async (args) => {
      const { preference } = args as { preference: string };
      return bridgeCall(() =>
        bridge.post("/api/agent/execution/env", { preference }),
      );
    },
  );

  server.registerTool(
    "set_trading_mode",
    mcpToolConfig("set_trading_mode"),
    async (args) => {
      const { mode } = args as { mode: string };
      return bridgeCall(() => bridge.post("/api/agent/mode", { mode }));
    },
  );

  server.registerTool(
    "get_agent_settings",
    mcpToolConfig("get_agent_settings"),
    bridgeWrap(bridge, () => bridge.get("/api/agent/settings")),
  );

  server.registerTool(
    "set_active_market",
    mcpToolConfig("set_active_market"),
    async (args) => {
      const { active_market } = args as { active_market: string };
      return bridgeCall(() =>
        bridge.patch("/api/agent/settings", { active_market }),
      );
    },
  );

  server.registerTool(
    "get_trading_style",
    mcpToolConfig("get_trading_style"),
    async () => bridgeCall(() => bridge.get("/api/agent/style")),
  );

  server.registerTool(
    "set_trading_style",
    mcpToolConfig("set_trading_style"),
    async (args) => {
      const { trading_style, scalp_max_trades, sync_interval } = args as {
        trading_style: string;
        scalp_max_trades?: number;
        sync_interval?: boolean;
      };
      return bridgeCall(() =>
        bridge.post("/api/agent/style", {
          trading_style,
          scalp_max_trades,
          sync_interval,
        }),
      );
    },
  );

  server.registerTool(
    "get_scalp_status",
    mcpToolConfig("get_scalp_status"),
    async () => bridgeCall(() => bridge.get("/api/agent/scalp")),
  );

  server.registerTool(
    "start_scalp_session",
    mcpToolConfig("start_scalp_session"),
    async (args) => {
      const { symbol, max_trades, market, interval, notional } = args as {
        symbol: string;
        max_trades: number;
        market?: "crypto" | "forex";
        interval?: string;
        notional?: number;
      };
      return bridgeCall(() =>
        bridge.post("/api/agent/scalp", {
          action: "start",
          symbol,
          max_trades,
          market,
          interval,
          notional,
        }),
      );
    },
  );

  server.registerTool(
    "stop_scalp_session",
    mcpToolConfig("stop_scalp_session"),
    async () =>
      bridgeCall(() => bridge.post("/api/agent/scalp", { action: "stop" })),
  );

  server.registerTool(
    "set_futures_enabled",
    mcpToolConfig("set_futures_enabled"),
    async (args) => {
      const { futures_enabled, default_leverage } = args as {
        futures_enabled: boolean;
        default_leverage?: number;
      };
      return bridgeCall(() =>
        bridge.patch("/api/agent/settings", {
          futures_enabled,
          ...(default_leverage != null ? { default_leverage } : {}),
        }),
      );
    },
  );

  server.registerTool(
    "set_kill_switch",
    mcpToolConfig("set_kill_switch"),
    async (body) =>
      bridgeCall(() => bridge.post("/api/agent/kill-switch", body)),
  );

  server.registerTool(
    "run_trade_maintenance",
    mcpToolConfig("run_trade_maintenance"),
    bridgeWrap(bridge, () => bridge.post("/api/agent/maintenance")),
  );

  server.registerTool(
    "send_telegram_menu",
    mcpToolConfig("send_telegram_menu"),
    bridgeWrap(bridge, () => bridge.post("/api/agent/telegram/menu")),
  );

  server.registerTool(
    "capture_chart_snapshot",
    mcpToolConfig("capture_chart_snapshot"),
    async (body) => {
      try {
        const res = (await bridge.post("/api/agent/chart/snapshot", {
          ...body,
          response_format: "json",
        })) as ChartSnapshotBridgeResult;
        return resolveChartSnapshotResponse(bridge, res);
      } catch (e) {
        return formatBridgeError(e);
      }
    },
  );

  server.registerTool(
    "get_recommendation_chart",
    mcpToolConfig("get_recommendation_chart"),
    async (args) => {
      const { recommendation_id } = args as { recommendation_id: number };
      try {
        const res = (await bridge.get(`/api/agent/chart/${recommendation_id}`, {
          format: "json",
        })) as {
          ok?: boolean;
          image_base64?: string;
          chart_image_url?: string;
        };

        if (res.image_base64) {
          return chartInlineContent(
            {
              ok: true,
              recommendation_id,
              content_type: "image/png",
            },
            res.image_base64,
          );
        }

        const chartUrl = res.chart_image_url;
        if (typeof chartUrl === "string" && chartUrl.endsWith("/mt5")) {
          const polled = await pollBridgeMt5ChartPng(
            bridge,
            String(recommendation_id),
            { maxMs: 15_000 },
          );
          if ("timeout" in polled) {
            return chartTimeoutContent(
              { chartUrl, recommendation_id },
              polled.retryAfterMs,
            );
          }
          return chartInlineContent(
            { ok: true, recommendation_id, chartUrl },
            polled.base64,
          );
        }

        return {
          content: [{ type: "text", text: JSON.stringify(res, null, 2) }],
        };
      } catch (e) {
        if (e instanceof BridgeError && e.status === 503 && e.body) {
          const body = e.body as Record<string, unknown>;
          const chartUrl = body.chart_image_url;
          if (typeof chartUrl === "string" && chartUrl.endsWith("/mt5")) {
            const polled = await pollBridgeMt5ChartPng(
              bridge,
              String(recommendation_id),
              { maxMs: 15_000 },
            );
            if ("timeout" in polled) {
              return chartTimeoutContent(
                { chartUrl, recommendation_id },
                polled.retryAfterMs,
              );
            }
            return chartInlineContent(
              { ok: true, recommendation_id, chartUrl },
              polled.base64,
            );
          }
          return {
            content: [{ type: "text", text: JSON.stringify(body, null, 2) }],
            isError: true,
          };
        }
        return formatBridgeError(e);
      }
    },
  );
}
