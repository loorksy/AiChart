import { z } from "zod";
import { DESTRUCTIVE, IDEMPOTENT_WRITE, READ_ONLY } from "../registry.js";
import type { ToolDefinition } from "./types.js";
import { zLooseBoolean, zMarket, zSymbol } from "./shapes.js";

/**
 * MCP surface for the Quant Agent ANALYSIS engine, its scheduled monitors, and
 * its fired-signal log — the second half of `quantAgentSchemas.ts`, kept in its
 * own file because that one is already the recommendation/chat surface.
 *
 * Ported from QuantDinger (https://github.com/OpenByteInc/QuantDinger),
 * Copyright Open Byte Inc., licensed under the Apache License, Version 2.0
 * (http://www.apache.org/licenses/LICENSE-2.0). Source:
 * `mcp_server/src/quantdinger_mcp/server.py` — its `MCP_TOOL_NAMES` surface,
 * specifically the signal-alert block (`list_signal_alerts`,
 * `create_signal_alert`, `update_signal_alert`, `delete_signal_alert`) and its
 * two mutating-tool guards: `_idempotency_headers` (`idempotency_key` required
 * on every mutating tool, max 120 chars) and `delete_signal_alert`'s
 * `confirm_delete=true is required` refusal.
 *
 * What changed on the port, and why:
 *
 *  - **THE EXECUTION TOOLS ARE NOT PORTED.** Upstream's surface includes
 *    `place_quick_order`, `stop_strategy`, `emergency_stop_trading` and
 *    `cancel_open_paper_orders`. Nothing in this file, and nothing anywhere in
 *    the quant group, may place, cancel, close, or size an order — that is a
 *    hard product rule here, not a configuration choice, and
 *    `__tests__/noExecutionTools.test.ts` asserts it by name pattern, by input
 *    field, by contract risk class, and by bridge path so a future edit cannot
 *    reintroduce one quietly.
 *  - **Analysis is the headline, not an afterthought.** Upstream has no
 *    equivalent of `quant_agent_run_analysis`: its MCP surface exposes
 *    strategies/jobs/factors, and the fast-analysis engine is reachable only
 *    from its own web app. The four analysis tools here are new, modelled on
 *    the AiChart web routes that Wave 1 ported.
 *  - **Field names are camelCase**, matching the web routes these tools call
 *    (`notifyTelegram`, `notifyWebhookUrl`) and `open_trade`'s existing
 *    `idempotencyKey`, rather than upstream's `idempotency_key`/`confirm_delete`.
 *    `__tests__/quantRouteParity.test.ts` compares every field here against the
 *    zod schema of the route it reaches, so the two cannot drift.
 *  - **`payload: dict` becomes typed fields.** Upstream's alert CRUD takes an
 *    opaque dict validated server-side; a monitor here declares its real
 *    fields so a host can complete them and a bad call fails before the wire.
 *
 * Every description opens with the same disambiguation the recommendation and
 * chat tools use: this is a completely separate engine from Lonora.
 */

/** Shared prefix — see the note above; identical duty to `QUANT_AGENT_DISAMBIGUATION`. */
const QUANT_ANALYSIS_DISAMBIGUATION =
  "AiChart's separate, independent Quant Agent LLM analysis engine — NOT Lonora's analysis, and NOT create_recommendation. It reads market data, scores it, and writes only to Quant Agent's own analysis store; it never touches the canonical recommendation lifecycle, and it never places, modifies, cancels, or sizes any broker order.";

/**
 * Upstream's `_idempotency_headers`: required on every mutating tool, max 120
 * characters. Optional in the SCHEMA on purpose — a missing key comes back as
 * a readable refusal body from the handler naming the field, which is what a
 * model can act on, rather than an SDK -32602 that reads like a client bug.
 */
export const IDEMPOTENCY_KEY_MAX_LENGTH = 120;

const zIdempotencyKey = z
  .string()
  .min(1)
  .max(IDEMPOTENCY_KEY_MAX_LENGTH)
  .optional()
  .describe(
    "REQUIRED. A stable caller-chosen key (max 120 chars) that makes this call safe to retry — repeat the SAME key to retry, and the first result is replayed instead of a second write. Omitting it is refused, not defaulted. Scope: this MCP session's process (the web routes do not yet honour x-idempotency-key), so it protects a retried tool call, not a cross-process replay.",
  );

/** Upstream's `confirm_delete: bool = False` gate, same refuse-without-it semantics. */
const zConfirmDelete = zLooseBoolean
  .optional()
  .describe(
    "REQUIRED for this tool to do anything: pass true to confirm the deletion. Without it the call is refused and nothing is deleted.",
  );

const zAnalysisId = z
  .string()
  .min(1)
  .max(64)
  .describe("Quant Agent analysis id (a UUID from quant_agent_run_analysis / quant_agent_list_analyses)");

const zMonitorId = z
  .number()
  .int()
  .positive()
  .describe("Quant Agent monitor id from quant_agent_list_monitors");

const zInterval = z
  .string()
  .min(1)
  .max(16)
  .describe("Timeframe, e.g. 15m, 1h, 4h, 1d");

const zCursor = z
  .string()
  .min(1)
  .max(128)
  .optional()
  .describe("nextCursor from the previous page; omit for the first page");

const zWebhookUrl = z
  .string()
  .max(2048)
  .optional()
  .describe(
    "https:// webhook to POST each fire to. Must be https — http is rejected by the route. Empty string clears it.",
  );

/**
 * How often the monitor may speak. Mirrors the route's
 * `z.enum(MONITOR_FIRE_RULES)`; `always` is the default there, so omitting this
 * keeps the behaviour every existing monitor already has.
 */
const zFireRule = z
  .enum(["always", "on_change"])
  .optional()
  .describe(
    "always = notify on every signal (default). on_change = notify only when the call differs from the last one that fired, so a repeated SELL stays quiet.",
  );

export const QUANT_ANALYSIS_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "quant_agent_run_analysis",
    domain: "quantAgent",
    description: `${QUANT_ANALYSIS_DISAMBIGUATION} Queues a FULL multi-timeframe analysis of one symbol — objective technical/fundamental/sentiment/macro scoring, cross-timeframe consensus, a 24h/3d/1w/1m trend outlook, a validated trading plan (entry/stop/take-profit), and a data-quality report naming every input that was absent — and returns job_id/status immediately; the run itself takes tens of seconds and never blocks this call. When: the operator wants Quant Agent's own read on a pair, or before quant_agent_create_monitor so there is a baseline to compare fires against. Not for a chart or raw candles — this returns DERIVED analysis only, never a plottable bar series; and not for Lonora's analysis, which is a different engine with a different store. side-effect: writes one row to Quant Agent's own analysis store; no order is placed, previewed, or sized, and position_size_pct in the result is display-only. Async contract: poll jobs_wait([job_id]) until all_terminal is true, then read the complete analysis object from that response — do not call this tool again to check status. One analysis per symbol+timeframe runs at a time; a duplicate while one is in flight is refused by the route, which is why idempotencyKey is required. Example: symbol=XAUUSD&interval=1h&idempotencyKey=xauusd-1h-2026-08-09T10.`,
    inputSchema: {
      symbol: zSymbol.describe("e.g. EURUSD, XAUUSD"),
      market: zMarket,
      interval: zInterval.optional().describe("Primary timeframe, e.g. 1h. Defaults to 1h."),
      locale: z
        .enum(["ar", "en"])
        .optional()
        .describe("Language of the analysis prose. Defaults to the account locale."),
      idempotencyKey: zIdempotencyKey,
    },
    annotations: IDEMPOTENT_WRITE,
  },
  {
    name: "quant_agent_get_analysis",
    domain: "quantAgent",
    description: `${QUANT_ANALYSIS_DISAMBIGUATION} Returns one stored analysis in full by its id — verdict, confidence, scores, consensus, trend outlook, the trading plan, the detailed prose, reasons, risks, and the data-quality report. When: reading the result of a completed quant_agent_run_analysis job, or re-reading an analysis quant_agent_list_analyses returned. Not for Lonora recommendation ids — Quant Agent ids live in a completely separate id space and store, and another account's id answers "not found". read-only. Example: id=4f1c....`,
    inputSchema: {
      id: zAnalysisId,
    },
    annotations: READ_ONLY,
  },
  {
    name: "quant_agent_list_analyses",
    domain: "quantAgent",
    description: `${QUANT_ANALYSIS_DISAMBIGUATION} Lists the caller's own analysis history, newest first, keyset-paginated. When: reviewing what this account has already analysed before spending a fresh run, or finding the id of a recent analysis to read in full. Not a cross-account feed — it only ever returns rows this account owns. read-only. Paging: pass the returned nextCursor back as cursor; limit is capped at 50 server-side. Example: symbol=XAUUSD&limit=10.`,
    inputSchema: {
      symbol: zSymbol.optional().describe("Narrow to one pair, e.g. XAUUSD"),
      limit: z.number().int().min(1).max(50).optional().describe("Rows per page, 1-50 (default 20)"),
      cursor: zCursor,
    },
    annotations: READ_ONLY,
  },
  {
    name: "quant_agent_analysis_accuracy",
    domain: "quantAgent",
    description: `${QUANT_ANALYSIS_DISAMBIGUATION} Returns this account's measured calibration: hit rate per confidence bucket over the last 90 days of VALIDATED analyses, plus the sample counts behind it. When: before quoting a confidence number to the operator — this is what says whether this engine's high-confidence calls have actually been the reliable ones. Not a promise about the next trade, and not Lonora's strategy performance (that is get_strategy_performance, a different engine). A bucket with too few samples is OMITTED rather than reported as a percentage — say "not enough history" for it; never infer a rate from validatedCount alone. read-only. Example: no arguments for the whole engine, or symbol=XAUUSD for one pair.`,
    inputSchema: {
      symbol: zSymbol.optional().describe("Narrow to one pair; omit for the whole engine"),
    },
    annotations: READ_ONLY,
  },
  {
    name: "quant_agent_list_monitors",
    domain: "quantAgent",
    description: `${QUANT_ANALYSIS_DISAMBIGUATION} Lists this account's scheduled Quant Agent monitors — symbol, timeframe, notification channels, enabled state, and when each last ran. When: before creating a monitor (so a duplicate is not added) or before updating/deleting one, to get its id. Not the fired-signal history — that is quant_agent_list_signals; this is the schedule, not what it produced. read-only.`,
    inputSchema: {},
    annotations: READ_ONLY,
  },
  {
    name: "quant_agent_create_monitor",
    domain: "quantAgent",
    description: `${QUANT_ANALYSIS_DISAMBIGUATION} Creates a scheduled monitor that re-runs the Quant Agent analysis for one symbol+timeframe and notifies the operator when it fires. When: the operator asks to be alerted about a pair rather than asking now — check quant_agent_list_monitors first so an identical monitor is not created twice. Not a trading trigger: a fire sends a notification and writes a signal-event row, and can never open, size, or cancel a position. side-effect: writes a new ENABLED monitor row to Quant Agent's own store and schedules recurring analysis runs against this account. Requires idempotencyKey. Example: symbol=XAUUSD&interval=4h&notifyTelegram=true&idempotencyKey=monitor-xauusd-4h.`,
    inputSchema: {
      symbol: zSymbol.describe("e.g. EURUSD, XAUUSD"),
      market: zMarket,
      interval: zInterval,
      notifyTelegram: zLooseBoolean.optional().describe("Send each fire to Telegram (default true)"),
      notifyPush: zLooseBoolean.optional().describe("Send each fire as a web push (default false)"),
      notifyWebhookUrl: zWebhookUrl,
      fireRule: zFireRule,
      idempotencyKey: zIdempotencyKey,
    },
    annotations: IDEMPOTENT_WRITE,
  },
  {
    name: "quant_agent_update_monitor",
    domain: "quantAgent",
    description: `${QUANT_ANALYSIS_DISAMBIGUATION} Updates one monitor this account owns — its timeframe, its notification channels, or whether it is enabled at all. When: the operator wants an existing alert paused, resumed, retimed, or re-routed. Pausing (enabled=false) is the right answer to "stop alerting me" — quant_agent_delete_monitor throws the monitor away instead, and a paused monitor can be resumed. Not a way to reach another account's monitor: an id that is not yours answers "not found", it never updates anything. side-effect: modifies the monitor's schedule and delivery. Requires idempotencyKey. Example: id=12&enabled=false&idempotencyKey=pause-monitor-12.`,
    inputSchema: {
      id: zMonitorId,
      interval: zInterval.optional(),
      notifyTelegram: zLooseBoolean.optional().describe("Send each fire to Telegram"),
      notifyPush: zLooseBoolean.optional().describe("Send each fire as a web push"),
      notifyWebhookUrl: zWebhookUrl,
      enabled: zLooseBoolean.optional().describe("false pauses the monitor without deleting it"),
      fireRule: zFireRule,
      idempotencyKey: zIdempotencyKey,
    },
    annotations: IDEMPOTENT_WRITE,
  },
  {
    name: "quant_agent_delete_monitor",
    domain: "quantAgent",
    description: `${QUANT_ANALYSIS_DISAMBIGUATION} Permanently deletes one monitor this account owns. When: the operator explicitly wants the monitor GONE — if they only want it to stop alerting for now, call quant_agent_update_monitor with enabled=false instead, which is reversible. Not reversible: the schedule and its settings are destroyed, and recreating it means quant_agent_create_monitor from scratch. Its past fires in quant_agent_list_signals are a separate log and are NOT deleted with it. side-effect: destroys the monitor row. REFUSED unless confirmDelete=true, and requires idempotencyKey. Example: id=12&confirmDelete=true&idempotencyKey=delete-monitor-12.`,
    inputSchema: {
      id: zMonitorId,
      confirmDelete: zConfirmDelete,
      idempotencyKey: zIdempotencyKey,
    },
    annotations: DESTRUCTIVE,
  },
  {
    name: "quant_agent_list_signals",
    domain: "quantAgent",
    description: `${QUANT_ANALYSIS_DISAMBIGUATION} Lists every monitor FIRE this account has had, newest first, with the decision that fired and the per-channel delivery outcome — including sends that failed. When: the operator asks what their alerts have been saying, or whether an alert actually got delivered. Not the monitor list itself (quant_agent_list_monitors) and not the analysis history (quant_agent_list_analyses) — this is the append-only record of what fired. There is no write or delete counterpart by design: a log the caller can rewrite is not evidence. read-only. Paging: pass the returned nextCursor back as cursor; limit is capped at 100 server-side. Example: symbol=XAUUSD&decision=SELL&limit=20.`,
    inputSchema: {
      symbol: zSymbol.optional().describe("Narrow to one pair, e.g. XAUUSD"),
      monitorId: zMonitorId.optional().describe("Narrow to fires from one monitor id"),
      decision: z
        .enum(["BUY", "SELL", "HOLD"])
        .optional()
        .describe("Narrow to fires that carried this decision"),
      limit: z.number().int().min(1).max(100).optional().describe("Rows per page, 1-100 (default 20)"),
      cursor: zCursor,
    },
    annotations: READ_ONLY,
  },
  {
    name: "quant_agent_get_signal",
    domain: "quantAgent",
    description: `${QUANT_ANALYSIS_DISAMBIGUATION} Returns one fired signal in full by its id, with the decision, the monitor it came from, and the per-channel delivery outcome. When: investigating one alert the operator is asking about, e.g. "did the 4h XAUUSD alert actually send?". Not for an analysis id — signals and analyses have separate id spaces; another account's id answers "not found". read-only. Example: id=sig_....`,
    inputSchema: {
      id: z.string().min(1).max(64).describe("Quant Agent signal-event id from quant_agent_list_signals"),
    },
    annotations: READ_ONLY,
  },
];

export const QUANT_ANALYSIS_TOOL_BY_NAME = Object.fromEntries(
  QUANT_ANALYSIS_TOOL_DEFINITIONS.map((t) => [t.name, t]),
) as Record<string, ToolDefinition>;
