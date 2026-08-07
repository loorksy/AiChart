/**
 * One vocabulary for cross-call steering, shared by every tool's response.
 *
 * Before this module: `resolve_agent_skills` returned an ad-hoc `nextStep`
 * string, the chart-capture tools returned ad-hoc `note`/`image_delivery`
 * guardrail prose, and `create_recommendation`'s validation failure returned
 * an ad-hoc "fix these fields" message — three different shapes for the same
 * underlying need (tell the model what happens next). This module is the
 * single place that decides `next_step` (what call, if any, is the real next
 * step) and `recovery_tool` (what call, if any, fixes a given failure mode) so
 * every tool draws from the same table instead of reinventing the wording.
 *
 * `note` / `image_delivery` / `user_message` on the chart-capture tools are
 * DELIBERATELY left alone (see mcp/src/tools/imageDelivery.ts) — they were
 * tuned against an observed hallucination failure mode and need to stay as
 * blunt, repetitive prose in the model's face; folding them into a generic
 * `recovery_tool` pointer would lose that urgency. `resolve_agent_skills`'s
 * old camelCase `nextStep` string IS migrated onto `next_step` below — that
 * one was a true duplicate, not a distinct concern.
 */

import { isBrokerForexSuffix, toCanonicalForexSymbol } from "../lib/forexSymbol.js";

export interface NextStep {
  tool: string;
  reason: string;
  params?: Record<string, unknown> | null;
}

export interface Adjustment {
  field: string;
  requested: unknown;
  used: unknown;
  reason: string;
}

export interface RecoveryInfo {
  /** Tool to call immediately, or null when no tool call fixes this. */
  recovery_tool: string | null;
  recovery_reason: string;
}

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

// ---------------------------------------------------------------------------
// recovery_tool — keyed by the real BridgeErrorCode taxonomy
// (web/src/lib/bridge/errors.ts). Mirrored here rather than imported: mcp/ and
// web/ are separate packages with no shared runtime dependency, and the codes
// are a stable wire contract, not internal web plumbing. mcp/test/contract
// coverage should assert this list stays in sync if the web enum grows.
// ---------------------------------------------------------------------------

const RECOVERY_BY_CODE: Record<string, RecoveryInfo> = {
  STALE_QUOTE: {
    recovery_tool: "get_market_price",
    recovery_reason:
      "The quote behind this check was stale. get_market_price forces a fresh read — call it immediately, then retry the call that failed.",
  },
  CONNECTION_OFFLINE: {
    recovery_tool: "get_mt5_status",
    recovery_reason:
      "The broker connection is down. get_mt5_status reports whether connect_mt5 is needed — call it immediately before retrying.",
  },
  EXECUTION_UNAUTHORIZED: {
    recovery_tool: "get_agent_trade_mode",
    recovery_reason:
      "Unrecoverable by any tool call: execution needs the operator's own standing authorisation, which only they can grant. get_agent_trade_mode reports the current mode — call it immediately to see exactly what's missing, then ask the operator rather than retrying.",
  },
  RATE_LIMITED: {
    recovery_tool: null,
    recovery_reason:
      "Unrecoverable by a different tool call: wait for retryAfterMs (carried on this error) and retry the SAME call.",
  },
  VALIDATION_ERROR: {
    recovery_tool: null,
    recovery_reason:
      "Unrecoverable by a different tool call: the payload sent was rejected. Fix the field(s) named in the error message and retry the SAME call.",
  },
  UPSTREAM_TIMEOUT: {
    recovery_tool: null,
    recovery_reason:
      "Unrecoverable by a different tool call: a transient upstream failure. Safe to retry the SAME call (open_trade's idempotencyKey dedupes for 24h, so a retry there can never double-place).",
  },
  SPREAD_TOO_WIDE: {
    recovery_tool: "get_trade_readiness",
    recovery_reason:
      "The spread was too wide for safe execution right now. get_trade_readiness reports the current spread — call it immediately to see if it has narrowed before retrying.",
  },
  MARKET_CLOSED: {
    recovery_tool: "get_trade_readiness",
    recovery_reason:
      "Unrecoverable right now: the trading session is closed. get_trade_readiness reports session state — call it immediately to confirm, then wait for the session to reopen.",
  },
};

/** Named fix for a BridgeErrorCode, or null for an unmapped/unknown code. */
export function recoveryFor(errorCode: string | undefined): RecoveryInfo | null {
  if (!errorCode) return null;
  return RECOVERY_BY_CODE[errorCode] ?? null;
}

// ---------------------------------------------------------------------------
// adjustments — symbol canonicalization is the one confirmed real coercion
// (Phase 0 finding §4.3): 5 of 11 market tools silently strip broker suffixes
// and uppercase via toCanonicalForexSymbol() before querying, with nothing in the
// response saying so today.
// ---------------------------------------------------------------------------

const SYMBOL_CANONICALIZED_TOOLS = new Set([
  "get_market_snapshot",
  "get_multi_timeframe_snapshot",
  "get_market_price",
  "get_ohlc",
  "detect_market_regime",
]);

export function symbolAdjustments(toolName: string, requestedSymbol: unknown): Adjustment[] {
  if (!SYMBOL_CANONICALIZED_TOOLS.has(toolName)) return [];
  if (typeof requestedSymbol !== "string" || !requestedSymbol) return [];
  if (!isBrokerForexSuffix(requestedSymbol)) return [];
  return [
    {
      field: "symbol",
      requested: requestedSymbol,
      used: toCanonicalForexSymbol(requestedSymbol),
      reason:
        "Broker suffix stripped and uppercased to the canonical instrument key this tool actually reads from — never tell the operator the requested spelling was queried verbatim.",
    },
  ];
}

// ---------------------------------------------------------------------------
// next_step — only where a genuinely deterministic, safe next call exists.
// Deliberately does NOT chain into any bucket-A (money-moving) tool: those
// require the operator's own explicit approval, which no tool response can
// establish on its own. Deliberately does NOT chain a read tool into
// create_recommendation either — the model, not a mechanical chain, owns the
// analytical decision (lonora system rules). Where no real chain exists the
// table has no entry and next_step is simply absent — never fabricated.
// ---------------------------------------------------------------------------

type NextStepFn = (args: Record<string, unknown>, data: unknown) => NextStep | null;

const NEXT_STEP_BY_TOOL: Record<string, NextStepFn> = {
  // Fixed session-start sequence (this server's own MCP instructions):
  // get_agent_capabilities -> get_account_overview -> get_agent_trade_mode.
  get_agent_capabilities: () => ({
    tool: "get_account_overview",
    reason: "Fixed session-start sequence — load the account picture next.",
    params: null,
  }),
  get_account_overview: () => ({
    tool: "get_agent_trade_mode",
    reason: "Fixed session-start sequence — confirm the operator's standing trade mode before awaiting their request.",
    params: null,
  }),

  // run_backtest no longer goes through bridgeCall (Phase 3: it queues a job
  // and returns immediately — see core.ts) so this table is never consulted
  // for it; its next_step (-> jobs_wait) is embedded directly in that
  // response. The REAL next step after a completed backtest — pulling
  // get_strategy_performance for the live-vs-expected comparison before
  // citing it as evidence — is stated in run_backtest's own description
  // instead, since it only makes sense once jobs_wait reports all_terminal,
  // not immediately.

  // request_approval only queues an intent and messages Telegram — confirm
  // it actually queued with the id the operator will see, before reporting success.
  request_approval: (_args, data) => {
    const d = obj(data);
    if (d.ok !== true) return null;
    return {
      tool: "get_pending_approvals",
      reason: "Confirms the intent was actually queued (and its id) before telling the operator it was sent.",
      params: null,
    };
  },

  // Approving executes immediately — confirm the trade actually opened
  // rather than trusting the approval response alone.
  respond_approval: (args, data) => {
    const d = obj(data);
    if (args.action !== "approve" || d.ok !== true || d.dry_run === true) return null;
    return {
      tool: "get_open_trades",
      reason: "Approval executes the trade immediately — confirm it actually opened before reporting success to the operator.",
      params: null,
    };
  },

  // open_trade: verify a real (non-preview) success before claiming it opened.
  open_trade: (_args, data) => {
    const d = obj(data);
    if (d.dry_run === true || d.ok !== true) return null;
    return {
      tool: "get_open_trades",
      reason: "Confirm the order actually opened and get its live details before reporting success to the operator.",
      params: null,
    };
  },

  // close_trade: verify the position is actually gone.
  close_trade: (_args, data) => {
    const d = obj(data);
    if (d.dry_run === true) return null;
    return {
      tool: "get_open_trades",
      reason: "Confirm the trade is actually gone (or, for a partial failure, which ones remain).",
      params: null,
    };
  },

  // These 3 have NO before/after lookup by ticket (documented gap — see their
  // dry_run preview_available:false reason). That absence makes an AFTER
  // check the only way to know the change really landed, so it is genuinely
  // load-bearing here, not a nice-to-have.
  modify_sl_tp: (_args, data) => {
    const d = obj(data);
    if (d.dry_run === true || d.ok !== true) return null;
    return {
      tool: "get_live_account",
      reason: "This tool has no before/after lookup by ticket — confirm the new levels actually took effect by checking live positions.",
      params: null,
    };
  },
  cancel_mt5_order: (_args, data) => {
    const d = obj(data);
    if (d.dry_run === true || d.ok !== true) return null;
    return {
      tool: "get_live_account",
      reason: "This tool has no before/after lookup by ticket — confirm the order is actually gone by checking live positions/orders.",
      params: null,
    };
  },
  close_partial: (_args, data) => {
    const d = obj(data);
    if (d.dry_run === true || d.ok !== true) return null;
    return {
      tool: "get_live_account",
      reason: "This tool has no before/after lookup by ticket — confirm the remaining size actually changed by checking live positions.",
      params: null,
    };
  },

  // Verify a mode/connection change actually stuck.
  set_agent_trade_mode: () => ({
    tool: "get_agent_trade_mode",
    reason: "Confirm the mode change was actually recorded before telling the operator it took effect.",
    params: null,
  }),
  connect_mt5: () => ({
    tool: "get_mt5_status",
    reason: "Confirm the connection actually succeeded before telling the operator the account is linked.",
    params: null,
  }),
  disconnect_mt5: () => ({
    tool: "get_mt5_status",
    reason: "Confirm the account is actually unlinked before telling the operator.",
    params: null,
  }),

  // A drawing/clear write's own success doesn't prove the chart state
  // reflects it — the live chart poll is the actual source of truth.
  draw_on_chart: (args) => ({
    tool: "get_chart_state",
    reason: "Confirm the drawing actually applied to the chart state.",
    params: args.layout_id ? { layout_id: args.layout_id } : null,
  }),
  clear_chart_drawings: (args) => ({
    tool: "get_chart_state",
    reason: "Confirm the drawings were actually cleared from the chart state.",
    params: args.layout_id ? { layout_id: args.layout_id } : null,
  }),
};

export function nextStepFor(
  toolName: string,
  args: Record<string, unknown>,
  ok: boolean,
  data: unknown,
): NextStep | null {
  if (!ok) return null;
  const fn = NEXT_STEP_BY_TOOL[toolName];
  if (!fn) return null;
  return fn(args, data);
}

// ---------------------------------------------------------------------------
// assistant_response — for the 7 bucket-A (consequential) tools only. Built
// exclusively from fields already present on the real response; never
// invents a figure the response didn't compute.
// ---------------------------------------------------------------------------

function fmtOpenTrade(d: Record<string, unknown>): string | null {
  if (d.dry_run === true) {
    const wo = obj(d.would_open);
    const c = obj(d.computed);
    if (!wo.symbol) return null;
    return `Preview only — nothing was placed. Would open ${wo.side} ${wo.symbol} (${wo.order_type}), risking ${c.risk_amount ?? "?"} ${c.currency ?? ""} (${c.risk_pct ?? "?"}% of ${c.equity ?? "?"} equity on ${c.broker ?? "the connected broker"}).`;
  }
  if (d.ok === true) {
    const tradeId = d.tradeId ? `, trade #${d.tradeId}` : "";
    return `Trade opened — status: ${d.status ?? "unknown"}${tradeId}.`;
  }
  return `Trade NOT opened: ${d.reason ?? d.status ?? "denied"}.`;
}

function fmtCloseTrade(d: Record<string, unknown>): string | null {
  if (d.dry_run === true) {
    if (Array.isArray(d.trades)) {
      const n = d.trades.length;
      return `Preview only — nothing was closed. ${n} open trade(s) checked.`;
    }
    if (d.would_close === false) return `Would NOT close: ${d.reason ?? "unsupported broker for this platform"}.`;
    if (d.would_close === true) return `Preview only — nothing was closed. Estimated PnL at current price: ${d.estimated_pnl ?? "unavailable"}.`;
    return null;
  }
  if (typeof d.closed === "number") {
    return `Closed ${d.closed} trade(s), ${d.failed ?? 0} failed, total PnL ${d.totalPnl ?? "unknown"}.`;
  }
  if (d.ok === true) return `Trade closed — PnL ${d.pnl ?? "unknown"}.`;
  if (d.ok === false) return `Trade NOT closed: ${d.reason ?? "unknown reason"}.`;
  return null;
}

function fmtRequestApproval(d: Record<string, unknown>): string | null {
  if (d.dry_run === true) {
    const ws = obj(d.would_send);
    if (!ws.symbol) return null;
    return `Preview only — no approval request sent. Card would show ${ws.side} ${ws.symbol}, entry ${ws.entry ?? "market"}, stop ${ws.stop_loss}, target ${ws.take_profit ?? "none"}.`;
  }
  if (d.ok === true) {
    return `Approval request #${d.intentId} sent to Telegram: ${d.telegramDelivered ? "delivered" : `NOT delivered — ${d.telegramReasonAr ?? "reason unknown"}`}.`;
  }
  return null;
}

function fmtRespondApproval(d: Record<string, unknown>): string | null {
  if (d.dry_run === true) {
    if (d.ok === false) return `Preview: ${d.reason ?? "request not actionable"}.`;
    const pi = obj(d.intent);
    return `Preview only — nothing resolved. Would ${d.would}: ${pi.symbol ?? "?"} ${pi.side ?? "?"}. ${d.note ?? ""}`.trim();
  }
  if (d.status) return `Approval resolved — status: ${d.status}.`;
  return null;
}

function fmtNoLookupPreview(kind: string, would: unknown): string | null {
  const w = obj(would);
  if (!w.ticket) return null;
  return `Preview only — nothing was sent to the broker. ${kind} for ticket #${w.ticket} not verified against a live lookup (this platform cannot read a position/order by ticket yet).`;
}

function fmtModifySlTp(d: Record<string, unknown>): string | null {
  if (d.dry_run === true) return fmtNoLookupPreview("Requested SL/TP change", d.would_modify);
  if (d.ok === true) return "SL/TP modified on the broker.";
  if (d.ok === false) return `SL/TP modify failed: ${d.reason ?? d.error ?? "unknown reason"}.`;
  return null;
}

function fmtCancelOrder(d: Record<string, unknown>): string | null {
  if (d.dry_run === true) return fmtNoLookupPreview("Requested cancel", d.would_cancel);
  if (d.ok === true) return "Order cancelled on the broker.";
  if (d.ok === false) return `Order cancel failed: ${d.reason ?? d.error ?? "unknown reason"}.`;
  return null;
}

function fmtClosePartial(d: Record<string, unknown>): string | null {
  if (d.dry_run === true) return fmtNoLookupPreview("Requested partial close", d.would_close_partial);
  if (d.ok === true) return "Position partially closed on the broker.";
  if (d.ok === false) return `Partial close failed: ${d.reason ?? d.error ?? "unknown reason"}.`;
  return null;
}

const ASSISTANT_RESPONSE_BY_TOOL: Record<string, (d: Record<string, unknown>) => string | null> = {
  open_trade: fmtOpenTrade,
  close_trade: fmtCloseTrade,
  request_approval: fmtRequestApproval,
  respond_approval: fmtRespondApproval,
  modify_sl_tp: fmtModifySlTp,
  cancel_mt5_order: fmtCancelOrder,
  close_partial: fmtClosePartial,
};

/** Bucket-A tools only. Returns null for every other tool, or when the
 *  response doesn't match a known shape (never guesses). */
export function assistantResponseFor(toolName: string, data: unknown): string | null {
  const fn = ASSISTANT_RESPONSE_BY_TOOL[toolName];
  if (!fn) return null;
  return fn(obj(data));
}
