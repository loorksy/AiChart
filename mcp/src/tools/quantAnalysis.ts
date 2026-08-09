import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BridgeClient } from "../bridge/client.js";
import { formatBridgeResult } from "../bridge/client.js";
import { bridgeCall } from "./helpers.js";
import { startJob } from "./jobStore.js";
import { mcpToolConfig } from "./schemas/index.js";
import { IDEMPOTENCY_KEY_MAX_LENGTH } from "./schemas/quantAnalysisSchemas.js";

/**
 * Quant Agent ANALYSIS, MONITORS and SIGNALS over MCP — the handlers for
 * `schemas/quantAnalysisSchemas.ts`. Read that file's header first: it records
 * the QuantDinger provenance, the four upstream execution tools that are
 * deliberately NOT ported, and why the field names are camelCase.
 *
 * Ported from QuantDinger (https://github.com/OpenByteInc/QuantDinger),
 * Copyright Open Byte Inc., licensed under the Apache License, Version 2.0
 * (http://www.apache.org/licenses/LICENSE-2.0). Source:
 * `mcp_server/src/quantdinger_mcp/server.py` — `_idempotency_headers` and the
 * `confirm_delete` gate on `delete_signal_alert`. Changed on port: upstream
 * RAISES a ValueError for a missing idempotency key (FastMCP turns that into an
 * exception string); here both guards return this platform's canonical
 * `{ok:false, error:{code, message}}` refusal envelope, which
 * `formatBridgeResult` already flags as `isError` — the same shape a real
 * bridge failure produces, so a client needs one error path, not two.
 *
 * Every path here is under `/api/quant-agent/*`, reached through the same
 * shared `bridge` client as every other tool. Nothing in this file can reach
 * `/api/agent/trade/*`, and `__tests__/noExecutionTools.test.ts` asserts that
 * against the source text of this file so a future edit cannot quietly add one.
 */

/** Analysis runs are tens of seconds of candles + LLM; the route allows 120s. */
const ANALYSIS_JOB_TIMEOUT_MS = 120_000;

interface ReplayEntry {
  expiresAt: number;
  data: unknown;
}

/**
 * The idempotency replay guard, and an honest statement of its scope.
 *
 * The platform's REAL idempotency mechanism is `withBridge({idempotent: true})`
 * in `web/src/lib/bridge/withBridge.ts`: an `x-idempotency-key` header, a
 * per-user `idempotency_keys` table, a 24h TTL. The `/api/quant-agent/*` routes
 * do not use `withBridge`, and `BridgeClient` has no way to send a custom
 * header, so this MCP server cannot hand the key to the server that could
 * enforce it durably. What it CAN do is refuse to make the same write twice
 * itself, which is the case that actually happens: a host retrying one tool
 * call inside one conversation.
 *
 * Keyed on the BridgeClient INSTANCE, not on the key string. One
 * BridgeClient is built per MCP session (per request in stateless mode) from
 * one authenticated identity, so a caller-chosen key can never collide across
 * tenants — a module-global `Map<key, result>` here would have been a
 * cross-account read of somebody else's write, since the key is chosen by the
 * caller rather than issued by the server. A WeakMap also means the cache dies
 * with its session instead of pinning it.
 *
 * Consequences, stated rather than assumed away: nothing is deduplicated
 * across processes, across a restart, or across two sessions of the SAME user.
 * Only successful calls are stored — a failure must stay retriable.
 */
const REPLAY_BY_BRIDGE = new WeakMap<object, Map<string, ReplayEntry>>();
const REPLAY_TTL_MS = 24 * 60 * 60 * 1000;
const REPLAY_MAX_ENTRIES = 256;

function replayCache(bridge: object): Map<string, ReplayEntry> {
  let cache = REPLAY_BY_BRIDGE.get(bridge);
  if (!cache) {
    cache = new Map();
    REPLAY_BY_BRIDGE.set(bridge, cache);
  }
  return cache;
}

function replayLookup(bridge: object, tool: string, key: string): ReplayEntry | undefined {
  const cache = replayCache(bridge);
  const entry = cache.get(`${tool}:${key}`);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(`${tool}:${key}`);
    return undefined;
  }
  return entry;
}

function replayDelete(bridge: object, tool: string, key: string): void {
  replayCache(bridge).delete(`${tool}:${key}`);
}

function replayStore(bridge: object, tool: string, key: string, data: unknown): void {
  const cache = replayCache(bridge);
  const now = Date.now();
  for (const [k, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(k);
  }
  // Oldest-first eviction: a session that never stops writing must not grow
  // without bound, and the freshest keys are the ones a retry will ask for.
  while (cache.size >= REPLAY_MAX_ENTRIES) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    cache.delete(oldest.value);
  }
  cache.set(`${tool}:${key}`, { expiresAt: now + REPLAY_TTL_MS, data });
}

/** Plain objects get a replay marker so a caller can tell a retry from a write. */
function markReplay(data: unknown): unknown {
  if (!data || typeof data !== "object" || Array.isArray(data)) return data;
  return { ...(data as Record<string, unknown>), idempotent_replay: true };
}

/** This platform's canonical failure envelope — `formatBridgeResult` flags it as isError. */
function refuse(code: string, message: string) {
  return formatBridgeResult({ ok: false, error: { code, message, retriable: false } });
}

/** Upstream's `_idempotency_headers` validation, minus the header it cannot send. */
function readIdempotencyKey(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (!value || value.length > IDEMPOTENCY_KEY_MAX_LENGTH) return null;
  return value;
}

function idempotencyRefusal(tool: string) {
  return refuse(
    "QUANT_AGENT_IDEMPOTENCY_KEY_REQUIRED",
    `${tool} is a mutating tool: pass idempotencyKey — a stable string of your own choosing, 1-${IDEMPOTENCY_KEY_MAX_LENGTH} characters — and reuse the SAME value when retrying. Nothing was written.`,
  );
}

/** Trim+drop empties so an optional string field is never sent as `""` noise. */
function trimmed(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function registerQuantAnalysisTools(server: McpServer, bridge: BridgeClient) {
  /**
   * One mutating call: refuse without a key, replay a stored result for a
   * repeated key, otherwise perform it and store the result on success only.
   * `bridgeCall` still owns error formatting, so a thrown BridgeError never
   * reaches the cache.
   */
  async function mutate(
    tool: string,
    args: Record<string, unknown>,
    call: () => Promise<unknown>,
  ) {
    const key = readIdempotencyKey(args.idempotencyKey);
    if (!key) return idempotencyRefusal(tool);
    const cached = replayLookup(bridge, tool, key);
    if (cached) return formatBridgeResult(markReplay(cached.data));
    return bridgeCall(tool, args, async () => {
      const data = await call();
      replayStore(bridge, tool, key, data);
      return data;
    });
  }

  // — Analysis —————————————————————————————————————————————————————————

  server.registerTool(
    "quant_agent_run_analysis",
    mcpToolConfig("quant_agent_run_analysis"),
    async (args) => {
      const a = args as Record<string, unknown>;
      const tool = "quant_agent_run_analysis";
      const key = readIdempotencyKey(a.idempotencyKey);
      if (!key) return idempotencyRefusal(tool);

      // A retry returns the SAME job_id rather than queueing a second run —
      // the route's own in-flight lock would answer the duplicate with a 429,
      // and a 429 is a worse answer than the job the caller already has.
      const cached = replayLookup(bridge, tool, key);
      if (cached) return formatBridgeResult(markReplay(cached.data));

      // Queued, not awaited — same bucket-C contract as run_backtest and
      // run_market_analysis (see core.ts): several candle reads plus an LLM
      // call legitimately take tens of seconds, and this call must still
      // return well under the 500ms budget. The job's completed result is the
      // full stored analysis row, read back through jobs_wait.
      const job = startJob(tool, async () => {
        try {
          return await bridge.post(
            "/api/quant-agent/analysis",
            {
              symbol: String(a.symbol ?? "").trim(),
              market: a.market ?? "forex",
              ...(trimmed(a.interval) ? { interval: trimmed(a.interval) } : {}),
              ...(trimmed(a.locale) ? { locale: trimmed(a.locale) } : {}),
            },
            ANALYSIS_JOB_TIMEOUT_MS,
          );
        } catch (error) {
          // The key is stored before the run finishes so a fast retry gets the
          // job rather than a second run. A run that FAILED must not be what
          // that key means forever — release it so the same key can genuinely
          // re-run, exactly as a failed monitor write is never cached.
          replayDelete(bridge, tool, key);
          throw error;
        }
      });
      const payload = {
        job_id: job.id,
        status: job.status,
        tool,
        next_step: {
          tool: "jobs_wait",
          reason:
            "Poll until all_terminal is true; the completed result is the full Quant Agent analysis.",
          params: { jobs: [job.id] },
        },
      };
      replayStore(bridge, tool, key, payload);
      return formatBridgeResult(payload);
    },
  );

  server.registerTool(
    "quant_agent_get_analysis",
    mcpToolConfig("quant_agent_get_analysis"),
    async (args) => {
      const { id } = args as { id: string };
      return bridgeCall("quant_agent_get_analysis", args as Record<string, unknown>, () =>
        bridge.get(`/api/quant-agent/analysis/${encodeURIComponent(id.trim())}`),
      );
    },
  );

  server.registerTool(
    "quant_agent_list_analyses",
    mcpToolConfig("quant_agent_list_analyses"),
    async (args) => {
      const a = args as { symbol?: string; limit?: number; cursor?: string };
      return bridgeCall("quant_agent_list_analyses", args as Record<string, unknown>, () =>
        bridge.get("/api/quant-agent/analysis", {
          symbol: trimmed(a.symbol),
          limit: a.limit,
          cursor: trimmed(a.cursor),
        }),
      );
    },
  );

  server.registerTool(
    "quant_agent_analysis_accuracy",
    mcpToolConfig("quant_agent_analysis_accuracy"),
    async (args) => {
      const { symbol } = args as { symbol?: string };
      return bridgeCall("quant_agent_analysis_accuracy", args as Record<string, unknown>, () =>
        bridge.get("/api/quant-agent/analysis/accuracy", { symbol: trimmed(symbol) }),
      );
    },
  );

  // — Monitors ————————————————————————————————————————————————————————

  server.registerTool(
    "quant_agent_list_monitors",
    mcpToolConfig("quant_agent_list_monitors"),
    async (args) => {
      return bridgeCall("quant_agent_list_monitors", args as Record<string, unknown>, () =>
        bridge.get("/api/quant-agent/monitors"),
      );
    },
  );

  server.registerTool(
    "quant_agent_create_monitor",
    mcpToolConfig("quant_agent_create_monitor"),
    async (args) => {
      const a = args as Record<string, unknown>;
      return mutate("quant_agent_create_monitor", a, () =>
        bridge.post("/api/quant-agent/monitors", {
          symbol: String(a.symbol ?? "").trim(),
          market: a.market ?? "forex",
          interval: String(a.interval ?? "").trim(),
          ...(a.notifyTelegram === undefined ? {} : { notifyTelegram: a.notifyTelegram }),
          ...(a.notifyPush === undefined ? {} : { notifyPush: a.notifyPush }),
          ...(a.notifyWebhookUrl === undefined
            ? {}
            : { notifyWebhookUrl: String(a.notifyWebhookUrl).trim() }),
          ...(a.fireRule === undefined ? {} : { fireRule: a.fireRule }),
        }),
      );
    },
  );

  server.registerTool(
    "quant_agent_update_monitor",
    mcpToolConfig("quant_agent_update_monitor"),
    async (args) => {
      const a = args as Record<string, unknown>;
      return mutate("quant_agent_update_monitor", a, () =>
        bridge.patch(`/api/quant-agent/monitors/${encodeURIComponent(String(a.id))}`, {
          ...(trimmed(a.interval) ? { interval: trimmed(a.interval) } : {}),
          ...(a.notifyTelegram === undefined ? {} : { notifyTelegram: a.notifyTelegram }),
          ...(a.notifyPush === undefined ? {} : { notifyPush: a.notifyPush }),
          ...(a.notifyWebhookUrl === undefined
            ? {}
            : { notifyWebhookUrl: String(a.notifyWebhookUrl).trim() }),
          ...(a.enabled === undefined ? {} : { enabled: a.enabled }),
          ...(a.fireRule === undefined ? {} : { fireRule: a.fireRule }),
        }),
      );
    },
  );

  server.registerTool(
    "quant_agent_delete_monitor",
    mcpToolConfig("quant_agent_delete_monitor"),
    async (args) => {
      const a = args as Record<string, unknown>;
      // Upstream's order, kept: confirm first, then the idempotency key. A
      // caller who forgot to confirm should be told THAT, not told about a
      // key for a deletion they have not yet agreed to.
      if (a.confirmDelete !== true) {
        return refuse(
          "QUANT_AGENT_CONFIRM_REQUIRED",
          "quant_agent_delete_monitor permanently destroys the monitor: pass confirmDelete=true to proceed. To stop the alerts reversibly instead, call quant_agent_update_monitor with enabled=false. Nothing was deleted.",
        );
      }
      return mutate("quant_agent_delete_monitor", a, () =>
        bridge.delete(`/api/quant-agent/monitors/${encodeURIComponent(String(a.id))}`),
      );
    },
  );

  // — Fired signals ———————————————————————————————————————————————————

  server.registerTool(
    "quant_agent_list_signals",
    mcpToolConfig("quant_agent_list_signals"),
    async (args) => {
      const a = args as {
        symbol?: string;
        monitorId?: number;
        decision?: string;
        limit?: number;
        cursor?: string;
      };
      return bridgeCall("quant_agent_list_signals", args as Record<string, unknown>, () =>
        bridge.get("/api/quant-agent/signals", {
          symbol: trimmed(a.symbol),
          monitorId: a.monitorId,
          decision: trimmed(a.decision),
          limit: a.limit,
          cursor: trimmed(a.cursor),
        }),
      );
    },
  );

  server.registerTool(
    "quant_agent_get_signal",
    mcpToolConfig("quant_agent_get_signal"),
    async (args) => {
      const { id } = args as { id: string };
      return bridgeCall("quant_agent_get_signal", args as Record<string, unknown>, () =>
        bridge.get(`/api/quant-agent/signals/${encodeURIComponent(id.trim())}`),
      );
    },
  );
}
