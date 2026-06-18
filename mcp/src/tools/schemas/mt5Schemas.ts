import { z } from "zod";
import { DESTRUCTIVE, READ_ONLY } from "../registry.js";
import type { ToolDefinition } from "./types.js";
import { zChartDrawings, zInterval, zSide, zSymbol } from "./shapes.js";

export const MT5_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "connect_mt5",
    domain: "mt5",
    description:
      "متى: MetaApi/mt5local — لا مع FOREX_BACKEND=ea. side-effect: يحفظ credentials. مثال: platform=mt5&server=...",
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
    description: "متى: فصل MetaApi/mt5local. side-effect: disconnect.",
    inputSchema: {},
    annotations: DESTRUCTIVE,
  },
  {
    name: "get_mt5_status",
    domain: "mt5",
    description:
      "متى: MetaApi/mt5local. مع EA backend استخدم get_ea_diagnostics. read-only.",
    inputSchema: {},
    annotations: READ_ONLY,
  },
  {
    name: "get_live_account",
    domain: "mt5",
    description:
      "متى: قبل أي صفقة — MT5+Binance موحّد + quoteAgeMs. read-only.",
    inputSchema: {},
    annotations: READ_ONLY,
  },
  {
    name: "get_ea_diagnostics",
    domain: "mt5",
    description:
      "متى: فوركس EA — heartbeat، spread، retcodes. read-only. مثال: symbol=EURUSD.",
    inputSchema: { symbol: z.string().optional() },
    annotations: READ_ONLY,
  },
  {
    name: "get_ea_live_quotes",
    domain: "mt5",
    description:
      "متى: قبل open_trade فوركس. isFresh، spreadPips، freshCount. read-only. لا تنفّذ إذا stale.",
    inputSchema: { symbol: z.string().optional() },
    annotations: READ_ONLY,
  },
  {
    name: "capture_mt5_chart",
    domain: "mt5",
    description:
      "متى: re-capture MT5 مع entry/SL/TP/drawings/recommendation_id (draw_and_capture، poll حتى 30s). شارت ad-hoc بدون annotations → capture_chart_snapshot أسرع.",
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
      "متى: مركز MT5 مفتوح. side-effect: EA modify. مثال: ticket=123&stop_loss=1.08.",
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
      "متى: أمر معلّق MT5. side-effect: EA pending. EA v3+.",
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
    description: "متى: إلغاء pending MT5. side-effect: EA cancel.",
    inputSchema: { ticket: z.number().int().positive() },
    annotations: DESTRUCTIVE,
  },
  {
    name: "close_partial",
    domain: "mt5",
    description: "متى: إغلاق جزئي MT5. side-effect: EA partial close.",
    inputSchema: {
      ticket: z.number().int().positive(),
      lots: z.number().positive(),
    },
    annotations: DESTRUCTIVE,
  },
  {
    name: "query_mt5_terminal",
    domain: "mt5",
    description: "متى: margin/equity/pending snapshot. read-only via EA.",
    inputSchema: {},
    annotations: READ_ONLY,
  },
  {
    name: "request_ea_reconnect",
    domain: "mt5",
    description:
      "متى: quotes قديمة — مرة/دقيقة max. side-effect: flags DB. resync_candles اختياري.",
    inputSchema: { resync_candles: z.boolean().optional() },
    annotations: DESTRUCTIVE,
  },
];

export const MT5_TOOL_BY_NAME = Object.fromEntries(
  MT5_TOOL_DEFINITIONS.map((t) => [t.name, t]),
) as Record<string, ToolDefinition>;
