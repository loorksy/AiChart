import { z } from "zod";
import { DESTRUCTIVE, READ_ONLY } from "../registry.js";
import type { ToolDefinition } from "./types.js";
import { zChartDrawings, zInterval, zSymbol } from "./shapes.js";

export const BINANCE_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "connect_binance",
    domain: "binance",
    description:
      "When: first connect or switch testnet/prod. side-effect: saves encrypted keys. Verifies canTrade/Futures. Do not use verify_binance to save.",
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
      "When: before connect — verify without saving. read-only on keys (no save side-effect).",
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
      "When: before crypto trade. permissionReport. read-only.",
    inputSchema: { futuresRequired: z.boolean().optional() },
    annotations: READ_ONLY,
  },
  {
    name: "disconnect_binance",
    domain: "binance",
    description:
      "When: disconnect account. side-effect: deletes credentials. env optional.",
    inputSchema: { env: z.enum(["testnet", "prod"]).optional() },
    annotations: DESTRUCTIVE,
  },
  {
    name: "capture_binance_chart",
    domain: "binance",
    description:
      "When: crypto recommendation. PNG + chart_url_telegram. side-effect: Playwright capture. Example: symbol=BTCUSDT.",
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
    description: "When: before modify_futures_sl_tp. USDT-M positions. read-only.",
    inputSchema: { symbol: z.string().optional() },
    annotations: READ_ONLY,
  },
  {
    name: "get_futures_orders",
    domain: "binance",
    description: "When: pending futures orders. read-only.",
    inputSchema: { symbol: z.string().optional() },
    annotations: READ_ONLY,
  },
  {
    name: "modify_futures_sl_tp",
    domain: "binance",
    description:
      "When: open futures position. side-effect: modifies SL/TP. Example: symbol=BTCUSDT&stop_loss=60000.",
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
      "When: cancel pending order. side-effect: cancel. all=true for all symbol orders.",
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
