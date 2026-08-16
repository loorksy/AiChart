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
    recovery_tool: null,
    recovery_reason:
      "The market-data feed is unreachable. Nothing else recovers it — report the outage by name rather than analyzing without prices.",
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
      "Unrecoverable by a different tool call: a transient upstream failure. Safe to retry the SAME call.",
  },
  SPREAD_TOO_WIDE: {
    recovery_tool: "get_market_price",
    recovery_reason:
      "The spread was too wide to price the plan honestly. get_market_price reports the current book — call it to see whether it has narrowed before retrying.",
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
  // Fixed session-start sequence (this server's own MCP instructions). It used
  // to continue into the account picture and the operator's standing trade
  // mode; there is no account and no mode, so it ends at the skill catalogue.
  get_agent_capabilities: () => ({
    tool: "list_agent_skills",
    reason: "Fixed session-start sequence — discover the skill catalogue next.",
    params: null,
  }),

  // Fresh market evidence in hand → consult the statistical arsenal before
  // deciding. Deterministic and read-only: the platform's validated-strategy
  // machinery sat opt-in for a model that was never told to opt in, so the
  // ~60-strategy factory never reached a live decision.
  get_market_snapshot: (args) => {
    const symbol = typeof args.symbol === "string" ? args.symbol : null;
    if (!symbol) return null;
    return {
      tool: "get_strategy_performance",
      reason:
        "Before deciding, check whether a validated strategy deployment matches this symbol/timeframe — cite it as evidence when it exists; the plan stands either way.",
      params: { symbol },
    };
  },
  get_strategy_performance: (args) => {
    const symbol = typeof args.symbol === "string" ? args.symbol : null;
    if (!symbol) return null;
    return {
      tool: "find_similar_cases",
      reason:
        "Structural memory: what followed similar past moments, for BOTH directions — weigh it as evidence, never as a veto.",
      params: { symbol },
    };
  },

  // The execution follow-ups that used to live here — verifying that
  // open_trade actually opened, that respond_approval's approval reached the
  // broker, that modify_sl_tp's levels landed — are gone with the tools they
  // verified. This platform places no orders, so there is no broker-side state
  // to re-read and no claim of success to check.

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
// `assistant_response` used to phrase the outcome of the seven consequential
// tools — what open_trade opened, what respond_approval approved, what
// close_partial left behind. All seven are gone, so the map could only ever
// return null and the phrasing had nothing left to phrase. Its call site in
// helpers.ts went with it.
// ---------------------------------------------------------------------------
