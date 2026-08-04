import { z } from "zod";
import { DESTRUCTIVE, READ_ONLY } from "../registry.js";
import type { ToolDefinition } from "./types.js";
import { zChartDrawings, zDryRun, zInterval, zLooseBoolean, zSymbol } from "./shapes.js";

export const MT5_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "connect_mt5",
    domain: "mt5",
    description:
      "Links a MetaTrader account by saving its platform, server, login, and password for the MetaApi/mt5local backend. When: the operator gives their own MT5/MT4 credentials to connect for forex execution. Not to be called with credentials the operator didn't explicitly provide in this conversation. side-effect: saves credentials (encrypted; never echoed back). Connect MetaTrader · MT5/MT4 link · forex connect · MetaApi login. Call get_mt5_status next to confirm the connection actually succeeded before telling the operator the account is linked. Example: platform=mt5&server=...",
    inputSchema: {
      platform: z.enum(["mt4", "mt5"]),
      server: z.string().min(2),
      login: z.string().min(1),
      password: z.string().min(1),
    },
    annotations: DESTRUCTIVE,
  },
  {
    name: "disconnect_mt5",
    domain: "mt5",
    description:
      "Disconnects the MetaTrader account and removes the stored MetaApi/mt5local link. When: the operator explicitly asks to unlink or disconnect their MT5/MT4 account. Not reversible without the operator re-entering credentials via connect_mt5 — confirm this is really what they want before calling. side-effect: disconnects and removes the link; auto trade mode ends with it (a live connection is required for standing authorisation). Disconnect MetaTrader · unlink MT5/MT4 · remove forex link. Call get_mt5_status next to confirm the account is actually unlinked.",
    inputSchema: {},
    annotations: DESTRUCTIVE,
  },
  {
    name: "get_mt5_status",
    domain: "mt5",
    description:
      "Reports the connection status of the MetaApi/mt5local MetaTrader link. When: checking that backend's health, or right after connect_mt5/disconnect_mt5 to confirm the change took effect. Not for account balance/equity — that's get_live_account/get_account_overview. read-only. This is the recovery_tool for a CONNECTION_OFFLINE error elsewhere — call it immediately to see whether connect_mt5 is needed, don't ask the operator first.",
    inputSchema: {},
    annotations: READ_ONLY,
  },
  {
    name: "get_live_account",
    domain: "mt5",
    description:
      "Returns the unified live MT5 account state (open trades). Use get_market_price for live quotes and freshness (quoteAgeMs). When: before any trade, to verify the account is connected, or after modify_sl_tp/cancel_mt5_order/close_partial — none of those three have a before/after position lookup of their own, so this is how you confirm the change actually landed. Not for account balance/equity as the primary source — get_account_overview aggregates that more directly. read-only.",
    inputSchema: {},
    annotations: READ_ONLY,
    ui: { widget: "account-overview" },
  },
  {
    name: "get_account_symbols",
    domain: "mt5",
    description:
      "Lists all broker pairs/symbols in the MetaTrader account (the full Market Watch) with bid/ask/spread — every available pair, not a short list. When: the complete broker symbol universe is needed, or a broker-specific ticker must be found (e.g. to learn a symbol's exact broker spelling like XAUUSDm before a trade tool call). Not list_instruments' job — that's the OANDA/platform catalogue, not this account's own book. Defaults: no q filter (returns everything), limit unset (server default, ≤500). read-only. Example: market=forex.",
    inputSchema: {
      q: z.string().optional(),
      market: z.literal("forex").optional(),
      limit: z.number().int().min(1).max(500).optional(),
    },
    annotations: READ_ONLY,
  },
  {
    name: "capture_mt5_chart",
    domain: "mt5",
    description:
      "Captures a chart image, annotated with entry/SL/TP/drawings or a recommendation_id when given. The chart is attached inline AND returned as display_markdown — paste display_markdown verbatim in your reply so the operator sees it (link expires ~3 minutes). When: a chart annotated with trade levels must be captured or re-captured — for an ad-hoc chart without annotations capture_chart_snapshot is faster and should be preferred. Default inline_image=true. read-only on market; side-effect: capture.",
    inputSchema: {
      symbol: zSymbol,
      interval: zInterval,
      recommendation_id: z.number().int().positive().optional(),
      capture_key: z.string().optional(),
      entry: z.number().optional(),
      stop_loss: z.number().optional(),
      take_profit: z.number().optional(),
      drawings: zChartDrawings,
      inline_image: zLooseBoolean
        .optional()
        .describe(
          "Set false to skip the inline image copy (default true). The operator-facing display_markdown is returned either way.",
        ),
    },
    annotations: READ_ONLY,
  },
  {
    name: "modify_sl_tp",
    domain: "mt5",
    description:
      "Modifies the stop-loss (and optionally the take-profit) of an open MT5 position by ticket, on whichever backend holds it. When: an open MT5 position needs its protective levels moved. Not for a position on the self-hosted MT5 bridge — that backend does not support SL/TP modification at all and this call fails there; close or adjust from the platform directly instead. side-effect: broker modify. Example: ticket=123&stop_loss=1.08. dry_run:true confirms nothing is sent WITHOUT a numeric preview — this platform has no broker-agnostic way to read a position's current levels by ticket yet, so the requested values cannot be checked beforehand. Call get_live_account next to confirm the new levels actually took effect — there is no other before/after check for this tool.",
    inputSchema: {
      ticket: z.number().int().positive(),
      stop_loss: z.number().positive(),
      take_profit: z.number().positive().optional(),
      dry_run: zDryRun,
    },
    annotations: DESTRUCTIVE,
  },
  {
    name: "cancel_mt5_order",
    domain: "mt5",
    description:
      "Cancels a pending MT5 order by ticket, on whichever backend holds it. When: the operator wants a pending order withdrawn before it fills. Not for an already-open position — a filled position has no order to cancel; close_trade/close_partial are the tools for that. side-effect: broker cancel. dry_run:true confirms nothing is sent WITHOUT a numeric preview — this platform has no broker-agnostic way to read an order's state by ticket yet, so its existence cannot be confirmed beforehand. Call get_live_account next to confirm the order is actually gone — there is no other before/after check for this tool.",
    inputSchema: { ticket: z.number().int().positive(), dry_run: zDryRun },
    annotations: DESTRUCTIVE,
  },
  {
    name: "close_partial",
    domain: "mt5",
    description:
      "Closes part of an open MT5 position by ticket, reducing it by the given number of lots, on whichever backend holds it. When: taking partial profit or reducing exposure while keeping the rest of the position open. Not for a position on the self-hosted MT5 bridge — that backend only supports closing a position fully, not partially; this call fails there, use close_trade for the whole position instead. side-effect: broker partial close, realizes PnL on the closed portion. dry_run:true confirms nothing is sent WITHOUT a numeric preview — this platform has no broker-agnostic way to read a position's current size by ticket yet, so the requested lots cannot be checked against it beforehand. Call get_live_account next to confirm the remaining size actually changed — there is no other before/after check for this tool.",
    inputSchema: {
      ticket: z.number().int().positive(),
      lots: z.number().positive(),
      dry_run: zDryRun,
    },
    annotations: DESTRUCTIVE,
  },
];

export const MT5_TOOL_BY_NAME = Object.fromEntries(
  MT5_TOOL_DEFINITIONS.map((t) => [t.name, t]),
) as Record<string, ToolDefinition>;
