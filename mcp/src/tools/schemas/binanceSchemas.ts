import { z } from "zod";
import { DESTRUCTIVE, READ_ONLY } from "../registry.js";
import type { ToolDefinition } from "./types.js";
import { zChartDrawings, zInterval, zSymbol } from "./shapes.js";

export const BINANCE_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "connect_binance",
    domain: "binance",
    description:
      "متى: ربط أول مرة أو تبديل testnet/prod. side-effect: يحفظ مفاتيح مشفّرة. يتحقق canTrade/Futures. لا تستخدم verify_binance للحفظ.",
    inputSchema: {
      apiKey: z.string().min(10),
      apiSecret: z.string().min(10),
      env: z.enum(["testnet", "prod"]).optional(),
      label: z.string().max(60).optional(),
      futuresRequired: z.boolean().optional(),
    },
    annotations: DESTRUCTIVE,
  },
  {
    name: "verify_binance",
    domain: "binance",
    description:
      "متى: قبل connect — تحقق دون حفظ. read-only على المفاتيح (لا side-effect حفظ).",
    inputSchema: {
      apiKey: z.string().min(10),
      apiSecret: z.string().min(10),
      env: z.enum(["testnet", "prod"]).optional(),
      futuresRequired: z.boolean().optional(),
    },
    annotations: READ_ONLY,
  },
  {
    name: "get_binance_status",
    domain: "binance",
    description:
      "متى: قبل صفقة كريبتو. permissionReport. read-only.",
    inputSchema: { futuresRequired: z.boolean().optional() },
    annotations: READ_ONLY,
  },
  {
    name: "disconnect_binance",
    domain: "binance",
    description:
      "متى: فصل حساب. side-effect: يحذف credentials. env اختياري.",
    inputSchema: { env: z.enum(["testnet", "prod"]).optional() },
    annotations: DESTRUCTIVE,
  },
  {
    name: "capture_binance_chart",
    domain: "binance",
    description:
      "متى: توصية كريبتو. PNG + chart_url_telegram. side-effect: capture Playwright. مثال: symbol=BTCUSDT.",
    inputSchema: {
      symbol: zSymbol,
      interval: zInterval,
      market_type: z.enum(["spot", "futures"]).optional(),
      full_page: z.boolean().optional(),
      chart_drawings: zChartDrawings,
    },
    annotations: READ_ONLY,
  },
  {
    name: "get_futures_positions",
    domain: "binance",
    description: "متى: قبل modify_futures_sl_tp. مراكز USDT-M. read-only.",
    inputSchema: { symbol: z.string().optional() },
    annotations: READ_ONLY,
  },
  {
    name: "get_futures_orders",
    domain: "binance",
    description: "متى: أوامر معلّقة futures. read-only.",
    inputSchema: { symbol: z.string().optional() },
    annotations: READ_ONLY,
  },
  {
    name: "modify_futures_sl_tp",
    domain: "binance",
    description:
      "متى: مركز futures مفتوح. side-effect: يعدّل SL/TP. مثال: symbol=BTCUSDT&stop_loss=60000.",
    inputSchema: {
      symbol: zSymbol,
      stop_loss: z.number().positive().nullish(),
      take_profit: z.number().positive().nullish(),
    },
    annotations: DESTRUCTIVE,
  },
  {
    name: "cancel_futures_order",
    domain: "binance",
    description:
      "متى: إلغاء أمر معلّق. side-effect: cancel. all=true لكل أمر الرمز.",
    inputSchema: {
      symbol: zSymbol,
      order_id: z.number().int().positive().optional(),
      all: z.boolean().optional(),
    },
    annotations: DESTRUCTIVE,
  },
];

export const BINANCE_TOOL_BY_NAME = Object.fromEntries(
  BINANCE_TOOL_DEFINITIONS.map((t) => [t.name, t]),
) as Record<string, ToolDefinition>;
