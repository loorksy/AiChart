import { z } from "zod";
import { DESTRUCTIVE, READ_ONLY } from "../registry.js";
import type { ToolDefinition } from "./types.js";
import { zChartDrawings, zInterval, zSide, zSymbol } from "./shapes.js";

export const MT5_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "connect_mt5",
    domain: "mt5",
    description:
      "Connect MetaTrader · MT5/MT4 link · forex connect · MetaApi login. When: MetaApi/mt5local — not with FOREX_BACKEND=ea. side-effect: saves credentials. Example: platform=mt5&server=...",
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
      "Disconnect MetaTrader · unlink MT5/MT4 · remove forex link. When: disconnect MetaApi/mt5local. side-effect: disconnect.",
    inputSchema: {},
    annotations: DESTRUCTIVE,
  },
  {
    name: "get_mt5_status",
    domain: "mt5",
    description:
      "When: MetaApi/mt5local. With EA backend use get_ea_diagnostics. read-only.",
    inputSchema: {},
    annotations: READ_ONLY,
  },
  {
    name: "get_live_account",
    domain: "mt5",
    description:
      "When: before any trade — unified MT5+Binance + quoteAgeMs. read-only.",
    inputSchema: {},
    annotations: READ_ONLY,
    ui: { widget: "account-overview" },
  },
  {
    name: "get_ea_diagnostics",
    domain: "mt5",
    description:
      "When: forex EA — heartbeat, spread, retcodes. read-only. Example: symbol=EURUSD.",
    inputSchema: { symbol: z.string().optional() },
    annotations: READ_ONLY,
  },
  {
    name: "get_ea_live_quotes",
    domain: "mt5",
    description:
      "When: before open_trade forex. isFresh, spreadPips, freshCount. read-only. Do not execute if stale.",
    inputSchema: { symbol: z.string().optional() },
    annotations: READ_ONLY,
  },
  {
    name: "get_account_symbols",
    domain: "mt5",
    description:
      "All broker pairs/symbols in MetaTrader account (full Market Watch) with bid/ask/spread — see all available pairs, not a short list. Filters: q, market=forex|crypto. read-only. Example: market=forex.",
    inputSchema: {
      q: z.string().optional(),
      market: z.enum(["forex", "crypto"]).optional(),
      limit: z.number().int().min(1).max(500).optional(),
    },
    annotations: READ_ONLY,
  },
  {
    name: "capture_mt5_chart",
    domain: "mt5",
    description:
      "When: re-capture MT5 with entry/SL/TP/drawings/recommendation_id (draw_and_capture, poll up to 30s). Ad-hoc chart without annotations → capture_chart_snapshot is faster.",
    inputSchema: {
      symbol: zSymbol,
      interval: zInterval,
      recommendation_id: z.number().int().positive().optional(),
      capture_key: z.string().optional(),
      entry: z.number().optional(),
      stop_loss: z.number().optional(),
      take_profit: z.number().optional(),
      drawings: zChartDrawings,
    },
    annotations: READ_ONLY,
  },
  {
    name: "modify_sl_tp",
    domain: "mt5",
    description:
      "When: open MT5 position. side-effect: EA modify. Example: ticket=123&stop_loss=1.08.",
    inputSchema: {
      ticket: z.number().int().positive(),
      stop_loss: z.number().positive(),
      take_profit: z.number().positive().optional(),
    },
    annotations: DESTRUCTIVE,
  },
  {
    name: "open_pending_order",
    domain: "mt5",
    description:
      "When: MT5 pending order. side-effect: EA pending. EA v3+.",
    inputSchema: {
      symbol: zSymbol,
      side: zSide,
      order_type: z.enum(["limit", "stop", "stop_limit"]),
      lots: z.number().positive(),
      price: z.number().positive(),
      stop_loss: z.number().positive().optional(),
      take_profit: z.number().positive().optional(),
    },
    annotations: DESTRUCTIVE,
  },
  {
    name: "cancel_mt5_order",
    domain: "mt5",
    description: "When: cancel MT5 pending. side-effect: EA cancel.",
    inputSchema: { ticket: z.number().int().positive() },
    annotations: DESTRUCTIVE,
  },
  {
    name: "close_partial",
    domain: "mt5",
    description: "When: partial MT5 close. side-effect: EA partial close.",
    inputSchema: {
      ticket: z.number().int().positive(),
      lots: z.number().positive(),
    },
    annotations: DESTRUCTIVE,
  },
  {
    name: "query_mt5_terminal",
    domain: "mt5",
    description: "When: margin/equity/pending snapshot. read-only via EA.",
    inputSchema: {},
    annotations: READ_ONLY,
  },
  {
    name: "request_ea_reconnect",
    domain: "mt5",
    description:
      "When: stale quotes — once/minute max. side-effect: flags DB. resync_candles optional.",
    inputSchema: { resync_candles: z.boolean().optional() },
    annotations: DESTRUCTIVE,
  },
];

export const MT5_TOOL_BY_NAME = Object.fromEntries(
  MT5_TOOL_DEFINITIONS.map((t) => [t.name, t]),
) as Record<string, ToolDefinition>;
