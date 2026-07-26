import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BridgeClient } from "../bridge/client.js";
import { BridgeError, formatBridgeError, unwrapBridgePayload } from "../bridge/client.js";
import { bridgeCall, bridgeWrap } from "./helpers.js";
import { MCP_SERVER_VERSION } from "./registry.js";
import { mcpToolConfig } from "./schemas/index.js";
import {
  createRecommendationInput,
  findSimilarCasesInput,
  setAgentTradeModeInput,
} from "./schemas/coreSchemas.js";
import { discoverSkills, loadSkill } from "../skills/catalog.js";
import { selectMcpSkills } from "../skills/select.js";
import { gitCommit } from "../version.js";
import {
  chartInlineContent,
  chartTimeoutContent,
  multiTimeframeContent,
  pollBridgeMt5ChartPng,
  resolveChartSnapshotResponse,
  type ChartSnapshotBridgeResult,
  type MultiTimeframeBridgeResult,
} from "./chartInline.js";

/** Whole-request budget for parallel multi-timeframe capture (per-image ~8s). */
const MULTI_TIMEFRAME_TIMEOUT_MS = 25_000;

export function registerCoreTools(server: McpServer, bridge: BridgeClient) {
  server.registerTool(
    "get_account_overview",
    mcpToolConfig("get_account_overview"),
    async (args) => {
      const { include_live = true } = (args ?? {}) as {
        include_live?: boolean;
      };
      return bridgeCall(async () => {
        // A slow/failing live account never sinks the technical overview.
        const settled = await Promise.allSettled([
          bridge.get("/api/agent/status"),
          bridge.get("/api/agent/portfolio"),
          include_live
            ? bridge.get("/api/agent/live/account", undefined, 10000)
            : Promise.resolve({ skipped: true }),
          // Shared server-side state (plan §9): the overview carries the
          // operator's trade mode so the session starts knowing it — mcp-core
          // says ask ONCE when it is unset, never re-ask a stored choice.
          bridge.get("/api/agent/trade-mode"),
        ]);
        const val = (r: PromiseSettledResult<unknown>) => {
          if (r.status !== "fulfilled") {
            return {
              error:
                r.reason instanceof Error
                  ? r.reason.message
                  : String(r.reason),
            };
          }
          return unwrapBridgePayload(r.value);
        };
        return {
          connection: val(settled[0]),
          portfolio: val(settled[1]),
          live: include_live ? val(settled[2]) : { skipped: true },
          trade_mode: val(settled[3]),
        };
      }, { structured: true });
    },
  );

  server.registerTool(
    "get_trade_readiness",
    mcpToolConfig("get_trade_readiness"),
    async (args) => {
      const { symbol, market, practice } = args as {
        symbol?: string;
        market?: "forex";
        practice?: boolean;
      };
      return bridgeCall(() =>
        bridge.get("/api/agent/trade/readiness", {
          symbol,
          market,
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
                  mcpGitCommit: gitCommit(),
                  skills: (() => {
                    const { skills, root } = discoverSkills();
                    return {
                      catalogueAvailable: root != null,
                      count: skills.length,
                      names: skills.map(({ metadata }) => metadata.name),
                    };
                  })(),
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
    "list_agent_skills",
    mcpToolConfig("list_agent_skills"),
    async () => {
      try {
        const { skills, root } = discoverSkills();
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  ok: root != null,
                  catalogueRoot: root ? "agent/workspace/skills" : null,
                  count: skills.length,
                  skills: skills.map(({ metadata }) => metadata),
                  note:
                    "Metadata only. Load content explicitly with load_agent_skill — a listed skill does NOT count as loaded. Prefer resolve_agent_skills to select which to load for a request.",
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
    "resolve_agent_skills",
    mcpToolConfig("resolve_agent_skills"),
    async (args) => {
      const {
        request,
        intents,
        locale,
        market,
        max_skills: maxSkills,
        allow_execution_skills: allowExecutionSkills,
      } = (args ?? {}) as {
        request: string;
        intents?: string[];
        locale?: "ar" | "en";
        market?: string;
        max_skills?: number;
        allow_execution_skills?: boolean;
      };
      try {
        const discoverStarted = Date.now();
        const { skills, root } = discoverSkills();
        const discoveryMs = Date.now() - discoverStarted;
        const selection = selectMcpSkills(skills, {
          request,
          intents,
          locale,
          market: market ?? "forex",
          availableTools: ["render_cards"],
          maxSkills: maxSkills ?? 2,
          allowExecutionSkills: allowExecutionSkills === true,
        });
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  ok: root != null,
                  catalogueRoot: root ? "agent/workspace/skills" : null,
                  discovered: selection.discovered,
                  selected: selection.selected.map((s) => ({
                    name: s.name,
                    version: s.version,
                    category: s.category,
                    riskLevel: s.riskLevel,
                  })),
                  rejected: selection.rejected,
                  nextStep:
                    selection.selected.length > 0
                      ? "Call load_agent_skill once per selected.name. Do not claim a skill was used until load succeeds."
                      : "No skill load required for this request.",
                  note:
                    "Capability-scored selection (metadata only). Manual skill-file attachment is unnecessary. Do not show skill names, scores, or diagnostics to the operator.",
                  // Internal diagnostics for the host model / runtraces — not for operator chat.
                  diagnostics: {
                    discoveryMs,
                    selectionMs: selection.selectionMs,
                    candidates: selection.candidates,
                  },
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
    "load_agent_skill",
    mcpToolConfig("load_agent_skill"),
    async (args) => {
      const { name, version } = (args ?? {}) as { name: string; version?: string };
      try {
        const loaded = loadSkill(name, version);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  ok: true,
                  skill: { name: loaded.metadata.name, version: loaded.metadata.version },
                  riskLevel: loaded.metadata.riskLevel,
                  truncated: loaded.truncated,
                  content: loaded.content,
                  note:
                    "Evidence guidance only — this skill never overrides the model's market decision or technical execution controls.",
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (e) {
        // Honest failure: report the exact reason — never a fake success.
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                ok: false,
                error: e instanceof Error ? e.message : String(e),
              }),
            },
          ],
        };
      }
    },
  );

  server.registerTool(
    "get_portfolio",
    mcpToolConfig("get_portfolio"),
    async () =>
      bridgeCall(() => bridge.get("/api/agent/portfolio"), {
        structured: true,
      }),
  );

  server.registerTool(
    "get_open_trades",
    mcpToolConfig("get_open_trades"),
    async () =>
      bridgeCall(() => bridge.get("/api/agent/trades/open"), {
        structured: true,
      }),
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
    "run_backtest",
    mcpToolConfig("run_backtest"),
    async (body) =>
      // The contract declares 120s for this tool, but the bridge default is
      // 15s — submission does a warehouse export + research job creation and
      // legitimately exceeds 15s when the research service is busy with a
      // pipeline job. Without the override every manual backtest 504'd.
      bridgeCall(() => bridge.post("/api/agent/backtest", body, 120_000)),
  );

  server.registerTool(
    "get_strategy_performance",
    mcpToolConfig("get_strategy_performance"),
    async (args) => {
      const { strategy_id, symbol, timeframe } = args as {
        strategy_id: string;
        symbol?: string;
        timeframe?: string;
      };
      // Advances pending backtests server-side (research polling) — needs
      // more than the 15s bridge default when the service is under load.
      return bridgeCall(() =>
        bridge.get(
          "/api/agent/strategy/performance",
          {
            strategy_id,
            symbol,
            timeframe,
          },
          60_000,
        ),
      );
    },
  );

  server.registerTool(
    "create_recommendation",
    mcpToolConfig("create_recommendation"),
    async (body) => {
      const parsed = createRecommendationInput.safeParse(body);
      if (!parsed.success) {
        return formatBridgeError(
          new Error(
            parsed.error.issues
              .map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`)
              .join("; ") || "Invalid create_recommendation payload",
          ),
        );
      }
      return bridgeCall(() =>
        bridge.post("/api/agent/recommendation", parsed.data),
      );
    },
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
    "get_agent_settings",
    mcpToolConfig("get_agent_settings"),
    bridgeWrap(bridge, () => bridge.get("/api/agent/settings")),
  );

  server.registerTool(
    "get_agent_trade_mode",
    mcpToolConfig("get_agent_trade_mode"),
    bridgeWrap(bridge, () => bridge.get("/api/agent/trade-mode")),
  );

  server.registerTool(
    "set_agent_trade_mode",
    mcpToolConfig("set_agent_trade_mode"),
    async (body) => {
      const parsed = setAgentTradeModeInput.safeParse(body);
      if (!parsed.success) {
        return formatBridgeError(
          new Error(
            parsed.error.issues
              .map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`)
              .join("; ") || "Invalid set_agent_trade_mode payload",
          ),
        );
      }
      // The server re-checks confirmed_by_user for auto; sending actor lets the
      // audit trail say which surface the operator used.
      return bridgeCall(() =>
        bridge.patch("/api/agent/trade-mode", { ...parsed.data, actor: "mcp" }),
      );
    },
  );

  server.registerTool(
    "find_similar_cases",
    mcpToolConfig("find_similar_cases"),
    async (body) => {
      const parsed = findSimilarCasesInput.safeParse(body);
      if (!parsed.success) {
        return formatBridgeError(
          new Error(
            parsed.error.issues
              .map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`)
              .join("; ") || "Invalid find_similar_cases payload",
          ),
        );
      }
      return bridgeCall(() => bridge.post("/api/agent/similar-cases", parsed.data));
    },
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
    "capture_multi_timeframe_snapshot",
    mcpToolConfig("capture_multi_timeframe_snapshot"),
    async (args) => {
      const {
        inline_base64: inlineBase64,
        ...body
      } = (args ?? {}) as Record<string, unknown> & { inline_base64?: boolean };
      try {
        // The bridge fans out across timeframes itself — one round trip keeps
        // the images and their numbers in the same response.
        const res = (await bridge.post(
          "/api/agent/chart/multi-snapshot",
          body,
          MULTI_TIMEFRAME_TIMEOUT_MS,
        )) as MultiTimeframeBridgeResult;
        return multiTimeframeContent(res, {
          inlineBase64: inlineBase64 === true,
        });
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
