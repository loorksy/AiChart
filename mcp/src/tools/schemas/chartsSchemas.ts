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

const zStudy = z.object({
  id: z
    .string()
    .max(24)
    .describe("Stable study id (e.g. 'agent-rsi') — repeats replace, not stack"),
  name: z
    .enum(["RSI", "EMA", "SMA", "MACD", "BB", "ATR", "Stochastic", "VWAP"])
    .describe("Indicator: RSI | EMA | SMA | MACD | BB (Bollinger) | ATR | Stochastic | VWAP"),
  inputs: z
    .record(z.string(), z.union([z.number(), z.string(), z.boolean()]))
    .optional()
    .describe("Named study inputs, e.g. {length: 50} — omit for TradingView defaults"),
  pane: z
    .enum(["overlay", "separate"])
    .optional()
    .describe("overlay = price pane, separate = own pane — omit for the study's natural pane"),
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
      "Lists the user's saved chart layouts, returning each one's id, symbol, and link. When: before drawing or reading chart state on a NON-primary layout, to find the right layout_id. Not needed for the primary chart — every charts-domain tool defaults layout_id to it when omitted. read-only.",
    inputSchema: {},
    annotations: READ_ONLY,
  },
  {
    name: "get_chart_state",
    domain: "charts",
    description:
      "Reads the current state of the user's chart — symbol, timeframe, drawings, and active recommendation — for the given layout_id, defaulting to the primary chart. When: before editing a chart, so existing drawings and the recommendation are known, or right after draw_on_chart/clear_chart_drawings to confirm the write actually applied. Not for a picture of the chart — this is state data only; show_live_chart/capture_chart_snapshot render the image. read-only. Example: optional layout_id.",
    inputSchema: { layout_id: zLayoutId },
    annotations: READ_ONLY,
    ui: { widget: "live-chart" },
  },
  {
    name: "show_live_chart",
    domain: "charts",
    description:
      "Shows a live TradingView chart card in chat (the same library as the Lonora workspace) with ticks updating in place plus the agent's drawings and recommendation overlaid; it only displays and never draws or executes. When: the operator should watch gold live inside the conversation. Not for a one-off static picture — capture_chart_snapshot is cheaper for that; use this only when the operator wants to keep watching. Defaults: symbol/layout_id fall back to the user's primary chart, interval 15m. read-only.",
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
      "Draws directly on the user's live TradingView chart with the full toolset — lines, channels, zones, fibonacci, patterns, long/short positions, and forecasts — with colors, width, and style; drawings appear on the user's screen within seconds without refresh. Can also turn on chart indicators (studies) via `studies`: RSI, EMA, SMA, MACD, Bollinger (BB), ATR, Stochastic, VWAP — rendered as native TradingView indicators beside the drawings. When: the analysis should be made visible on the operator's own chart. Not for a chart to show inline in chat — that's capture_chart_snapshot/show_live_chart; this only writes to the operator's own TradingView view. Default mode=set (replaces existing drawings); add appends instead. Studies are only touched when `studies` is passed (mode=set replaces the study set, add merges by id); clear_chart_drawings removes them too. dataSource is metaapi-only (drawings are time-anchored against the account-sourced warehouse candles) — any other value is rejected, not silently coerced. Pass recommendation for a full trade box (entry/stop/targets). Call get_chart_state next to confirm the drawing actually applied.",
    inputSchema: {
      layout_id: zLayoutId,
      symbol: zSymbol.optional().describe("Change chart symbol (optional)"),
      interval: zInterval,
      // metaapi only: drawings are time-anchored against warehouse candles,
  // which come from users' linked accounts. "ea" was advertised, accepted,
  // and silently ignored — a contract that lies is worse than a narrower one.
  dataSource: z.literal("metaapi").optional(),
      mode: z.enum(["set", "add"]).default("set"),
      drawings: z.array(zDrawing).max(24),
      studies: z
        .array(zStudy)
        .max(8)
        .optional()
        .describe("Chart indicators to enable (native TV studies) — omit to leave the current set untouched"),
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
      "Clears every agent-drawn shape and the active recommendation from the user's chart, leaving candles and manually drawn TradingView objects untouched. When: the operator asks to clean the chart, or the current recommendation should be retracted. Not reversible — the cleared drawings are gone, not hidden; re-drawing means calling draw_on_chart again with the same shapes. Call get_chart_state next to confirm the drawings were actually cleared.",
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
      "Queues the full AI analysis for a pair — the same pipeline as the platform's Analyze button — and returns job_id/status immediately (well under 1s); the real run (technical drawings auto-drawn on the user's chart when layout_id is passed) can take up to two minutes and never blocks this call. When: the operator asks for a complete analysis rather than individual indicator calls. Not for a quick single-indicator read — get_market_snapshot/get_forex_indicators are far cheaper when the operator just wants one number. Consumes 4 user credits. Async contract: poll with jobs_wait([job_id]) (1-12 job ids per call) until all_terminal is true, then read the result from that response — do not call this tool again to check status, and never poll multiple jobs one at a time when they can go in one jobs_wait call. The completed result includes cost_evidence — the execution-cost contract with unit-named keys (observed_spread_price / observed_spread_pips), its source (observed_quote | live_cost_profile | session_profile | static_fallback | unavailable), freshness, and fallback_used/fallback_reason; unavailable is stated, never a zero.",
    inputSchema: {
      symbol: zSymbol.optional(),
      interval: zInterval.optional(),
      market: z.literal("forex").optional(),
      data_source: z.literal("metaapi").optional(),
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
