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
      "Lists all broker pairs/symbols in the MetaTrader account (the full Market Watch) with bid/ask/spread — every available pair, not a short list. When: the complete broker symbol universe is needed, or a broker-specific ticker must be found (e.g. to learn a symbol's exact broker spelling like XAUUSDm before a trade tool call). Not list_instruments' job — that's the shared catalogue, not this account's own book. Defaults: no q filter (returns everything), limit unset (server default, ≤500). read-only. Example: market=forex.",
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
  {
    name: "get_position",
    domain: "mt5",
    description:
      "Reads one open MT5 position by its own MetaApi position id (not the display ticket) — full detail including swap, commission, and unrealized profit. When: a single position's current broker-side state is needed by id, e.g. after get_live_account/get_open_trades returned its id and more detail is wanted. Not for listing every open position — get_live_account/get_open_trades already do that; this is the single-item lookup. MetaApi-only (not the self-hosted mt5local bridge). read-only.",
    inputSchema: { position_id: z.string().min(1) },
    annotations: READ_ONLY,
  },
  {
    name: "get_order",
    domain: "mt5",
    description:
      "Reads one pending MT5 order by its MetaApi order id. When: a single pending order's current state is needed by id. Not for listing every pending order — get_orders does that. MetaApi-only. read-only.",
    inputSchema: { order_id: z.string().min(1) },
    annotations: READ_ONLY,
  },
  {
    name: "get_orders",
    domain: "mt5",
    description:
      "Lists every pending order currently on the account (limit/stop orders awaiting trigger) — the full order book, not a filtered view. When: the operator wants to see or count all pending orders. MetaApi-only. read-only.",
    inputSchema: {},
    annotations: READ_ONLY,
  },
  {
    name: "get_history_orders",
    domain: "mt5",
    description:
      "Reads completed (filled or cancelled) MT5 orders — full order history, not just open positions. mode=ticket looks up one order by ticket; mode=position returns every order tied to a position id (its full life, including partial fills); mode=range walks a [from,to] window (ISO 8601 timestamps), paginated via offset/limit (server default limit 1000). When: the operator asks about past orders, a specific historical ticket, or an order's full lifecycle by position. Not for open positions — get_live_account/get_position cover those. MetaApi-only. read-only. Example: mode=range&from=2026-07-01T00:00:00Z&to=2026-08-01T00:00:00Z.",
    inputSchema: {
      mode: z.enum(["ticket", "position", "range"]),
      ticket: z.string().optional(),
      position_id: z.string().optional(),
      from: z.string().datetime({ offset: true }).optional(),
      to: z.string().datetime({ offset: true }).optional(),
      offset: z.number().int().min(0).optional(),
      limit: z.number().int().min(1).max(1000).optional(),
    },
    annotations: READ_ONLY,
  },
  {
    name: "get_deals",
    domain: "mt5",
    description:
      "Reads executed MT5 deals (actual fills — entries, exits, partial closes) — the ground truth of what happened on the account, distinct from orders (intent) or positions (current state). mode=ticket looks up deals for one ticket; mode=position returns every deal against a position id (its full fill history, e.g. a scaled entry or partial closes); mode=range walks a [from,to] window (ISO 8601), paginated via offset/limit (server default limit 1000). When: the operator asks what actually filled, wants a position's realized P&L trail, or needs trade history for a date range. MetaApi-only. read-only. Example: mode=range&from=2026-07-01T00:00:00Z&to=2026-08-01T00:00:00Z.",
    inputSchema: {
      mode: z.enum(["ticket", "position", "range"]),
      ticket: z.string().optional(),
      position_id: z.string().optional(),
      from: z.string().datetime({ offset: true }).optional(),
      to: z.string().datetime({ offset: true }).optional(),
      offset: z.number().int().min(0).optional(),
      limit: z.number().int().min(1).max(1000).optional(),
    },
    annotations: READ_ONLY,
  },
  {
    name: "get_server_time",
    domain: "mt5",
    description:
      "Reads the broker's own server time (and broker-local time string), straight from MetaApi. When: aligning session/calendar logic to the broker's actual clock instead of assuming UTC, or explaining why a daily/weekly bar just opened or closed. MetaApi-only. read-only.",
    inputSchema: {},
    annotations: READ_ONLY,
  },
  {
    name: "calculate_margin",
    domain: "mt5",
    description:
      "Calculates the margin the broker would require to open a hypothetical order, at the account's own leverage and symbol contract spec — before anything is sent. When: sizing a plan and checking it against free margin before proposing a trade, or answering 'how much margin would this need'. Not a trade — nothing is opened; this is pure calculation. MetaApi-only. read-only. Example: symbol=EURUSD&side=buy&volume=1&open_price=1.09.",
    inputSchema: {
      symbol: zSymbol,
      side: z.enum(["buy", "sell"]),
      volume: z.number().positive(),
      open_price: z.number().positive(),
    },
    annotations: READ_ONLY,
  },
  {
    name: "get_current_tick",
    domain: "mt5",
    description:
      "Reads the single most recent tick for a symbol (bid/ask/last at the moment of the broker's last update) — finer-grained than get_market_price when the exact last-tick timestamp matters. When: the operator needs the freshest possible quote moment, not just current bid/ask. Not for historical tick-by-tick data — MetaApi's RPC connection exposes only the latest tick, no tick history; use get_ohlc for historical price action instead. MetaApi-only. read-only. Example: symbol=EURUSD.",
    inputSchema: { symbol: zSymbol },
    annotations: READ_ONLY,
  },
  {
    name: "propose_modify_order",
    domain: "mt5",
    description:
      "Proposes changing a pending order's trigger price and/or SL/TP for operator approval — creates a pending intent and sends approve/reject buttons to Telegram, exactly like request_approval's two-step protocol. Nothing is sent to the broker until the operator approves via respond_approval. When: a pending limit/stop order (placed via open_trade or request_approval with order_type set) needs its price or protective levels changed. Not for an open position's SL/TP — that's modify_sl_tp, which acts under standing authorisation, not approval. At least one of open_price/stop_loss/take_profit is required. side-effect: creates a pending intent and sends a Telegram message; the broker is untouched until approved. Call get_pending_approvals next to confirm it queued. Example: order_id=123456&stop_loss=1.0850.",
    inputSchema: {
      order_id: z.string().min(1),
      open_price: z.number().positive().optional(),
      stop_loss: z.number().positive().optional(),
      take_profit: z.number().positive().optional(),
    },
    annotations: DESTRUCTIVE,
  },
  {
    name: "propose_cancel_order",
    domain: "mt5",
    description:
      "Proposes cancelling a pending order for operator approval — creates a pending intent and sends approve/reject buttons to Telegram, exactly like request_approval's two-step protocol. Nothing is sent to the broker until the operator approves via respond_approval. When: a pending order should be withdrawn but the operator has not already granted standing execution authority. Not the same as cancel_mt5_order, which cancels immediately under standing authorisation — use that one when the operator has already approved acting without a per-call check. side-effect: creates a pending intent and sends a Telegram message; the broker is untouched until approved. Call get_pending_approvals next to confirm it queued. Example: order_id=123456.",
    inputSchema: { order_id: z.string().min(1) },
    annotations: DESTRUCTIVE,
  },
  {
    name: "propose_close_position_by_symbol",
    domain: "mt5",
    description:
      "Proposes closing EVERY open position on a symbol for operator approval — including positions not opened through this platform (no local trade record required, unlike close_trade) — creates a pending intent and sends approve/reject buttons to Telegram, exactly like request_approval's two-step protocol. Nothing is sent to the broker until the operator approves via respond_approval. When: the operator wants every position on a symbol closed at once, e.g. a pre-existing position on a newly-linked account, or clearing exposure before news. Not for a single AiChart-tracked position — close_trade/close_partial are narrower and act under standing authorisation. side-effect: creates a pending intent and sends a Telegram message; the broker is untouched until approved. Call get_pending_approvals next to confirm it queued, then get_live_account after approval to confirm the positions are actually gone. Example: symbol=EURUSD.",
    inputSchema: { symbol: zSymbol },
    annotations: DESTRUCTIVE,
  },
];

export const MT5_TOOL_BY_NAME = Object.fromEntries(
  MT5_TOOL_DEFINITIONS.map((t) => [t.name, t]),
) as Record<string, ToolDefinition>;
