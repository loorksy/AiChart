import { z } from "zod";
import { DESTRUCTIVE, READ_ONLY } from "../registry.js";
import type { ToolDefinition } from "./types.js";
import { zChartDrawings, zInterval, zLooseBoolean, zSymbol } from "./shapes.js";

export const MT5_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "connect_mt5",
    domain: "mt5",
    description:
      "Links a MetaTrader account by saving its platform, server, login, and password for the MetaApi/mt5local backend. When: the operator wants to connect their MetaTrader account for forex execution. side-effect: saves credentials. Connect MetaTrader · MT5/MT4 link · forex connect · MetaApi login. Example: platform=mt5&server=...",
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
      "Disconnects the MetaTrader account and removes the stored MetaApi/mt5local link. When: the operator asks to unlink or disconnect their MT5/MT4 account. side-effect: disconnects and removes the link. Disconnect MetaTrader · unlink MT5/MT4 · remove forex link.",
    inputSchema: {},
    annotations: DESTRUCTIVE,
  },
  {
    name: "get_mt5_status",
    domain: "mt5",
    description:
      "Reports the connection status of the MetaApi/mt5local MetaTrader link. When: checking that backend's health. read-only.",
    inputSchema: {},
    annotations: READ_ONLY,
  },
  {
    name: "get_live_account",
    domain: "mt5",
    description:
      "Returns the unified live MT5 account state (open trades). Use get_market_price for live quotes and freshness (quoteAgeMs). When: before any trade, to verify the account is connected. read-only.",
    inputSchema: {},
    annotations: READ_ONLY,
    ui: { widget: "account-overview" },
  },
  {
    name: "get_account_symbols",
    domain: "mt5",
    description:
      "Lists all broker pairs/symbols in the MetaTrader account (the full Market Watch) with bid/ask/spread — every available pair, not a short list. When: the complete broker symbol universe is needed, or a broker-specific ticker must be found. Filters: q, market=forex. read-only. Example: market=forex.",
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
      "Captures a chart image, annotated with entry/SL/TP/drawings or a recommendation_id when given. The chart is attached inline AND returned as display_markdown — paste display_markdown verbatim in your reply so the operator sees it (link expires ~3 minutes). When: a chart annotated with trade levels must be captured or re-captured — for an ad-hoc chart without annotations capture_chart_snapshot is faster. read-only on market; side-effect: capture.",
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
      "Modifies the stop-loss (and optionally the take-profit) of an open MT5 position by ticket, on whichever backend holds it. When: an open MT5 position needs its protective levels moved. side-effect: broker modify. Example: ticket=123&stop_loss=1.08.",
    inputSchema: {
      ticket: z.number().int().positive(),
      stop_loss: z.number().positive(),
      take_profit: z.number().positive().optional(),
    },
    annotations: DESTRUCTIVE,
  },
  {
    name: "cancel_mt5_order",
    domain: "mt5",
    description:
      "Cancels a pending MT5 order by ticket, on whichever backend holds it. When: the operator wants a pending order withdrawn before it fills. side-effect: broker cancel.",
    inputSchema: { ticket: z.number().int().positive() },
    annotations: DESTRUCTIVE,
  },
  {
    name: "close_partial",
    domain: "mt5",
    description:
      "Closes part of an open MT5 position by ticket, reducing it by the given number of lots, on whichever backend holds it. When: taking partial profit or reducing exposure while keeping the rest of the position open. side-effect: broker partial close.",
    inputSchema: {
      ticket: z.number().int().positive(),
      lots: z.number().positive(),
    },
    annotations: DESTRUCTIVE,
  },
];

export const MT5_TOOL_BY_NAME = Object.fromEntries(
  MT5_TOOL_DEFINITIONS.map((t) => [t.name, t]),
) as Record<string, ToolDefinition>;
