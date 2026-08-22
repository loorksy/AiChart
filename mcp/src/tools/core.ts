import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BridgeClient } from "../bridge/client.js";
import {
  BridgeError, formatBridgeError, formatBridgeResult, unwrapBridgePayload } from "../bridge/client.js";
import { bridgeCall, bridgeWrap } from "./helpers.js";
import { getJob, waitForJobs } from "./jobStore.js";
import { MCP_SERVER_VERSION } from "./registry.js";
import { mcpToolConfig, TOOL_CATALOG } from "./schemas/index.js";
import {
  createRecommendationInput,
  findSimilarCasesInput,
  runPlanGatesInput,
  setAgentTradeModeInput,
  zActivationRuleStrict,
} from "./schemas/coreSchemas.js";
import { discoverSkills, loadSkill } from "../skills/catalog.js";
import { selectMcpSkills } from "../skills/select.js";
import { gitCommit } from "../version.js";
import {
  chartInlineContent,
  chartTimeoutContent,
  DRAW_CAPTURE_MAX_MS,
  multiTimeframeContent,
  pollBridgeMt5ChartPng,
  recommendationWithAutoChart,
  resolveChartSnapshotResponse,
  type ChartSnapshotBridgeResult,
  type MultiTimeframeBridgeResult,
} from "./chartInline.js";

/** Whole-request budget for parallel multi-timeframe capture (per-image ~8s). */
const MULTI_TIMEFRAME_TIMEOUT_MS = 25_000;

export function registerCoreTools(server: McpServer, bridge: BridgeClient) {


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
                  next_step: {
                    tool: "get_agent_settings",
                    reason: "Fixed session-start sequence — load product settings next.",
                    params: null,
                  },
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
        // Default the intent for bare market questions: skill metadata is
        // mostly English tokens, so an Arabic request with no declared intents
        // scored zero and EVERY skill came back "not_relevant_to_request" on
        // the product's primary locale.
        const effectiveIntents =
          intents?.length ? intents : ["analysis"];
        const selection = selectMcpSkills(skills, {
          request,
          intents: effectiveIntents,
          locale,
          market: market ?? "forex",
          availableTools: TOOL_CATALOG.map((t) => t.name),
          maxSkills: maxSkills ?? 3,
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
                  next_step:
                    selection.selected.length > 0
                      ? {
                          tool: "load_agent_skill",
                          reason:
                            "Call once per name in params.names — do not claim a skill was used until its load succeeds.",
                          params: { names: selection.selected.map((s) => s.name) },
                        }
                      : null,
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
    "get_trade_lessons",
    mcpToolConfig("get_trade_lessons"),
    async (args) => {
      const { symbol, pattern, limit, recent } = args as {
        symbol?: string;
        pattern?: string;
        limit?: number;
        recent?: boolean;
      };
      return bridgeCall("get_trade_lessons", args as Record<string, unknown>, () =>
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
    "jobs_wait",
    mcpToolConfig("jobs_wait"),
    async (args) => {
      const { jobs } = (args ?? {}) as { jobs: string[] };
      try {
        return formatBridgeResult(await waitForJobs(jobs));
      } catch (e) {
        return formatBridgeError(e);
      }
    },
  );

  server.registerTool(
    "show_jobs_by_ids",
    mcpToolConfig("show_jobs_by_ids"),
    async (args) => {
      const { jobs } = (args ?? {}) as { jobs: string[] };
      const records = jobs.map((id) => {
        const job = getJob(id);
        if (!job) return { id, status: "not_found" as const };
        return {
          id: job.id,
          tool: job.tool,
          status: job.status,
          ...(job.status === "completed" ? { result: job.result } : {}),
          ...(job.status === "failed" ? { error: job.error } : {}),
        };
      });
      return formatBridgeResult({ jobs: records, count: records.length });
    },
  );

  server.registerTool(
    "run_plan_gates",
    mcpToolConfig("run_plan_gates"),
    async (body) => {
      const parsed = runPlanGatesInput.safeParse(body ?? {});
      if (!parsed.success) {
        const issues = parsed.error.issues
          .slice(0, 6)
          .map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`);
        return formatBridgeError(
          new Error(
            `${issues.join("; ")}\nFix ONLY the fields above and call again — state the SAME plan you will submit to create_recommendation.`,
          ),
        );
      }
      // Same stale-client transport decode as create_recommendation: a cached
      // schema that predates the plan-contract fields serializes them as
      // strings. Decode deterministically; the contract does not get looser.
      const body2: Record<string, unknown> = { ...parsed.data };
      if (typeof body2.activation_rule === "string") {
        let decoded: unknown;
        try {
          decoded = JSON.parse(body2.activation_rule);
        } catch {
          return formatBridgeError(
            new Error("activation_rule: not valid JSON — send the rule object itself."),
          );
        }
        const strict = zActivationRuleStrict.safeParse(decoded);
        if (!strict.success) {
          const issues = strict.error.issues
            .slice(0, 4)
            .map((issue) => `activation_rule.${issue.path.join(".") || "kind"}: ${issue.message}`);
          return formatBridgeError(new Error(issues.join("; ")));
        }
        body2.activation_rule = strict.data;
      }
      for (const key of ["validity_candles", "entry_low", "entry_high"] as const) {
        if (typeof body2[key] === "string") body2[key] = Number(body2[key]);
      }
      return bridgeCall("run_plan_gates", body2, () =>
        bridge.post("/api/agent/gates/run", body2),
      );
    },
  );

  server.registerTool(
    "create_recommendation",
    mcpToolConfig("create_recommendation"),
    async (body) => {
      const raw: Record<string, unknown> = {
        ...((body ?? {}) as Record<string, unknown>),
      };
      if (typeof raw.take_profits === "string") {
        try {
          raw.take_profits = JSON.parse(raw.take_profits);
        } catch {
          /* leave as-is; schema/API will 400 */
        }
      }
      if (
        (raw.take_profit == null || raw.take_profit === "") &&
        Array.isArray(raw.take_profits) &&
        raw.take_profits.length > 0
      ) {
        raw.take_profit = Number(raw.take_profits[0]);
      }
      const parsed = createRecommendationInput.safeParse(raw);
      if (!parsed.success) {
        // Agent-facing: a short, fixable list — never the full zod dump, whose
        // flattened union paths read as contradictions. Full detail to stderr
        // with the payload keys, so an operator can still reconstruct the call.
        const issues = parsed.error.issues
          .slice(0, 6)
          .map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`);
        console.error(
          "[create_recommendation] rejected:",
          JSON.stringify({
            keys: Object.keys((body as Record<string, unknown>) ?? {}),
            issues: parsed.error.issues.slice(0, 20),
          }),
        );
        return formatBridgeError(
          new Error(
            `${issues.join("; ")}\n` +
              `Fix ONLY the fields above and call again. A conditional/anticipatory plan needs: ` +
              `activation_condition (string) + activation_rule {kind,...} + invalidation_rule + alternative_scenario + validity_candles. ` +
              `activation_rule.timeframe may be omitted (plan timeframe is used).`,
          ),
        );
      }
      // Stale-client transport decode. A connector whose cached tool schema
      // predates the plan-contract fields serializes them as STRINGS (measured
      // on a live Claude connector). Decode deterministically, then validate
      // against the SAME strict schema — the contract does not get looser, the
      // wire just gets read.
      const body2: Record<string, unknown> = { ...parsed.data };
      if (typeof body2.activation_rule === "string") {
        let decoded: unknown;
        try {
          decoded = JSON.parse(body2.activation_rule);
        } catch {
          return formatBridgeError(
            new Error("activation_rule: not valid JSON — send the rule object itself."),
          );
        }
        const strict = zActivationRuleStrict.safeParse(decoded);
        if (!strict.success) {
          const issues = strict.error.issues
            .slice(0, 4)
            .map((issue) => `activation_rule.${issue.path.join(".") || "kind"}: ${issue.message}`);
          return formatBridgeError(new Error(issues.join("; ")));
        }
        body2.activation_rule = strict.data;
      }
      for (const key of ["validity_candles", "entry_low", "entry_high"] as const) {
        if (typeof body2[key] === "string") body2[key] = Number(body2[key]);
      }
      try {
        const rec = await bridge.post("/api/agent/recommendation", body2);
        // V2-A0: the chart and card travel WITH the recommendation — the
        // operator sees the deliverable without a second tool call.
        return recommendationWithAutoChart(bridge, rec, {
          symbol: body2.symbol as string | undefined,
          timeframe: body2.timeframe as string | undefined,
          action: body2.action as string | undefined,
          take_profits: body2.take_profits,
        });
      } catch (e) {
        return formatBridgeError(e);
      }
    },
  );








  server.registerTool(
    "get_agent_settings",
    mcpToolConfig("get_agent_settings"),
    bridgeWrap("get_agent_settings", bridge, () => bridge.get("/api/agent/settings")),
  );

  // Manual execution (owner decision). The tool is a thin bridge: every real
  // guard — linked account, plan validity, volume grid, margin, idempotency,
  // one live order per plan, SL inside the order request — is server-side.
  server.registerTool(
    "execute_recommendation",
    mcpToolConfig("execute_recommendation"),
    async (body) => {
      const raw = (body ?? {}) as Record<string, unknown>;
      return bridgeCall("execute_recommendation", raw, () =>
        bridge.post("/api/execution/execute", {
          recommendation_id: String(raw.recommendation_id ?? ""),
          volume: Number(raw.volume),
          idempotency_key: String(raw.idempotency_key ?? ""),
        }),
      );
    },
  );

  server.registerTool(
    "get_execution_trades",
    mcpToolConfig("get_execution_trades"),
    async (body) => {
      const raw = (body ?? {}) as Record<string, unknown>;
      const days = Number(raw.days);
      const suffix = Number.isFinite(days) ? `?days=${Math.floor(days)}` : "";
      return bridgeCall("get_execution_trades", raw, () =>
        bridge.get(`/api/execution/trades${suffix}`),
      );
    },
  );



  server.registerTool(
    "get_account_status",
    mcpToolConfig("get_account_status"),
    async () =>
      bridgeCall("get_account_status", {}, () => bridge.get("/api/billing/summary")),
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
      return bridgeCall("find_similar_cases", parsed.data as Record<string, unknown>, () =>
        bridge.post("/api/agent/similar-cases", parsed.data),
      );
    },
  );

  server.registerTool(
    "send_telegram_menu",
    mcpToolConfig("send_telegram_menu"),
    bridgeWrap("send_telegram_menu", bridge, () => bridge.post("/api/agent/telegram/menu")),
  );

  server.registerTool(
    "capture_chart_snapshot",
    mcpToolConfig("capture_chart_snapshot"),
    async (body) => {
      const { inline_image: inlineImage, ...rest } = (body ?? {}) as Record<
        string,
        unknown
      > & { inline_image?: boolean };
      const input = rest as { symbol?: string; interval?: string };
      try {
        const res = (await bridge.post(
          "/api/agent/chart/snapshot",
          {
            ...rest,
            response_format: "json",
          },
          45_000,
        )) as ChartSnapshotBridgeResult;
        return resolveChartSnapshotResponse(
          bridge,
          res,
          DRAW_CAPTURE_MAX_MS,
          {
            tool: "capture_chart_snapshot",
            symbol: input.symbol,
            timeframe: input.interval,
          },
          { inlineImage: inlineImage !== false },
        );
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
        inline_image: inlineImage,
        ...body
      } = (args ?? {}) as Record<string, unknown> & {
        inline_base64?: boolean;
        inline_image?: boolean;
      };
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
          inlineImage: inlineImage !== false,
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
      const { recommendation_id, inline_image } = args as {
        recommendation_id: number;
        inline_image?: boolean;
      };
      const inlineOpts = { inlineImage: inline_image !== false };
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
            },
            res.image_base64,
            { tool: "get_recommendation_chart" },
            inlineOpts,
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
            polled.png,
            { tool: "get_recommendation_chart" },
            inlineOpts,
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
              polled.png,
              { tool: "get_recommendation_chart" },
              inlineOpts,
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
