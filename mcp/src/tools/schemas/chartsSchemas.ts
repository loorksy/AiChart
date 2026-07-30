import { z } from "zod";
import { READ_ONLY } from "../registry.js";
import type { ToolDefinition } from "./types.js";
import { zInterval, zSymbol } from "./shapes.js";

const zLayoutId = z
  .string()
  .regex(/^[A-Za-z0-9]{8,16}$/)
  .optional()
  .describe("User chart layout id (from list_chart_layouts) — defaults to primary chart");

const zPoint = z.object({
  price: z.number().describe("Price"),
  time: z
    .number()
    .nullable()
    .optional()
    .describe("Unix time (seconds or ms) — required for historical points"),
  barsAhead: z
    .number()
    .nullable()
    .optional()
    .describe("Bars ahead — for forecast_path future points only"),
});

const zDrawing = z.object({
  type: z
    .string()
    .describe(
      "Drawing type: price_line | trend_line | ray | channel | parallel_channel | regression_trend | zone | supply_zone | demand_zone | range_box | fib_retracement | forecast_path | polyline_pattern | triangle | neckline | long_position | short_position | labeled_arrow | arrow_up | arrow_down | text | pattern_label",
    ),
  confidence: z.number().min(0).max(100).default(70),
  label: z.string().max(64).optional().describe("Label shown on chart"),
  color: z.string().max(24).optional().describe("Hex color e.g. #22c55e"),
  width: z.number().min(1).max(4).optional().describe("Line width 1–4"),
  style: z.enum(["solid", "dashed", "dotted"]).optional(),
  fill: z.boolean().optional().describe("Fill zones"),
  fill_color: z.string().max(24).optional(),
  semanticRole: z
    .string()
    .max(32)
    .optional()
    .describe("support | resistance | entry | stop_loss | take_profit | trendline | pattern | forecast"),
  patternType: z
    .string()
    .max(40)
    .optional()
    .describe("e.g. double_bottom | head_and_shoulders | ascending_triangle"),
  points: z
    .array(zPoint)
    .max(10)
    .describe("Drawing points (time+price). long/short_position: entry point + meta"),
  meta: z
    .record(z.string(), z.unknown())
    .optional()
    .describe("For positions: {entry, stopLoss, takeProfit}"),
});

const zRecommendation = z.object({
  action: z.enum(["buy", "sell", "wait"]),
  entry: z.number().nullable().optional(),
  stop_loss: z.number().nullable().optional(),
  take_profit: z.number().nullable().optional(),
  confidence: z.number().min(0).max(100).optional(),
});

export const CHARTS_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "list_chart_layouts",
    domain: "charts",
    description:
      "When: before drawing — fetch user saved charts (id + symbol + link). read-only.",
    inputSchema: {},
    annotations: READ_ONLY,
  },
  {
    name: "get_chart_state",
    domain: "charts",
    description:
      "When: read current user chart state (symbol/frame/drawings/recommendation) before editing. read-only. Example: optional layout_id.",
    inputSchema: { layout_id: zLayoutId },
    annotations: READ_ONLY,
    ui: { widget: "live-chart" },
  },
  {
    name: "show_live_chart",
    domain: "charts",
    description:
      "When: show live mini chart card in chat (candles refresh ~every 4s + Claude drawings and recommendation on chart). read-only — does not draw or execute. Pass symbol or layout_id; defaults to user primary chart.",
    inputSchema: {
      symbol: zSymbol.optional(),
      interval: zInterval.optional(),
      layout_id: zLayoutId,
      market: z.literal("forex").optional(),
    },
    annotations: READ_ONLY,
    ui: { widget: "live-chart" },
  },
  {
    name: "draw_on_chart",
    domain: "charts",
    description:
      "When: draw directly on user live chart (TradingView) — supports all tools: lines/channels/zones/fibonacci/patterns/long-short positions/forecast, with colors, width, and style. Drawings appear on user screen within seconds without refresh. mode=set replaces, add appends. Pass recommendation for full trade box (entry/stop/targets).",
    inputSchema: {
      layout_id: zLayoutId,
      symbol: zSymbol.optional().describe("Change chart symbol (optional)"),
      interval: zInterval,
      // oanda only: drawings are time-anchored against warehouse candles, which
  // are OANDA-sourced. "ea" was advertised, accepted, and silently ignored —
  // a contract that lies is worse than a narrower one.
  dataSource: z.literal("oanda").optional(),
      mode: z.enum(["set", "add"]).default("set"),
      drawings: z.array(zDrawing).max(24),
      recommendation: zRecommendation.nullable().optional(),
      targets: z.array(z.number()).max(6).optional().describe("Additional profit targets"),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
    ui: { widget: "live-chart" },
  },
  {
    name: "clear_chart_drawings",
    domain: "charts",
    description:
      "When: clear all user chart drawings and recommendation. Does not touch candles or manual TradingView drawings.",
    inputSchema: { layout_id: zLayoutId },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
    },
  },
  {
    name: "run_market_analysis",
    domain: "charts",
    description:
      "When: full AI analysis for a pair (same as platform Analyze button): recommendation + technical drawings auto-drawn on user chart when layout_id passed. Consumes user credits (4). May take up to 120 seconds. The response includes cost_evidence — the execution-cost contract with unit-named keys (observed_spread_price / observed_spread_pips), its source (observed_quote | live_cost_profile | session_profile | static_fallback | unavailable), freshness, and fallback_used/fallback_reason; unavailable is stated, never a zero.",
    inputSchema: {
      symbol: zSymbol.optional(),
      interval: zInterval.optional(),
      market: z.literal("forex").optional(),
      data_source: z.enum(["oanda", "ea"]).optional(),
      layout_id: zLayoutId,
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    },
    ui: { widget: "analysis" },
  },
];

export const CHARTS_TOOL_BY_NAME = Object.fromEntries(
  CHARTS_TOOL_DEFINITIONS.map((t) => [t.name, t]),
) as Record<string, ToolDefinition>;
