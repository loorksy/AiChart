import { z } from "zod";
import { DESTRUCTIVE, IDEMPOTENT_WRITE, READ_ONLY } from "../registry.js";
import type { ToolDefinition } from "./types.js";
import {
  zBacktestStrategyId,
  zBacktestTimeframe,
  zChartDrawings,
  zConfidence,
  zInterval,
  zMarket,
  zSide,
  zSymbol,
  zTradeId,
} from "./shapes.js";

const recommendationSharedFields = {
  symbol: zSymbol,
  // Optional for BUY/SELL — server replaces with calibrated backtest evidence.
  confidence: zConfidence.optional(),
  rationale: z.string().min(10),
  factors: z.array(z.string()).min(1).max(8),
  timeframe: z.string().optional(),
  pattern_name: z.string().optional(),
  strategy_version: z.string().min(1).max(64).optional(),
  chart_drawings: zChartDrawings,
};

/** Structural BUY/SELL gate used by the MCP handler and unit tests. */
export const createRecommendationInput = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("wait"),
    ...recommendationSharedFields,
    entry: z.number().positive().optional(),
    stop_loss: z.number().positive().optional(),
    take_profit: z.number().positive().optional(),
    strategy_id: zBacktestStrategyId.optional(),
    backtested_confidence: zConfidence.optional(),
    market_regime: z.string().min(3).max(64).optional(),
  }),
  z.object({
    action: z.literal("buy"),
    ...recommendationSharedFields,
    strategy_id: zBacktestStrategyId,
    backtested_confidence: zConfidence,
    market_regime: z.string().min(3).max(64),
    entry: z.number().positive(),
    stop_loss: z.number().positive(),
    take_profit: z.number().positive(),
  }),
  z.object({
    action: z.literal("sell"),
    ...recommendationSharedFields,
    strategy_id: zBacktestStrategyId,
    backtested_confidence: zConfidence,
    market_regime: z.string().min(3).max(64),
    entry: z.number().positive(),
    stop_loss: z.number().positive(),
    take_profit: z.number().positive(),
  }),
]);

/** Catalog shape stays a ZodRawShape so MCP SDK handler inference remains intact. */
const createRecommendationCatalogShape = {
  symbol: zSymbol,
  action: z.enum(["buy", "sell", "wait"]),
  confidence: zConfidence.optional(),
  rationale: z.string().min(10),
  factors: z.array(z.string()).min(1).max(8),
  timeframe: z.string().optional(),
  pattern_name: z.string().optional(),
  strategy_version: z.string().min(1).max(64).optional(),
  chart_drawings: zChartDrawings,
  strategy_id: zBacktestStrategyId.optional(),
  backtested_confidence: zConfidence.optional(),
  market_regime: z.string().min(3).max(64).optional(),
  entry: z.number().positive().optional(),
  stop_loss: z.number().positive().optional(),
  take_profit: z.number().positive().optional(),
};

export const CORE_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "get_account_overview",
    domain: "core",
    description:
      "When: inspect the connected account. Combines technical connection status, portfolio, and live broker data. read-only.",
    inputSchema: {
      include_live: z
        .boolean()
        .optional()
        .describe("Include live account (slower) — false for faster summary"),
    },
    annotations: READ_ONLY,
    ui: { widget: "account-overview" },
  },
  {
    name: "get_trade_readiness",
    domain: "core",
    description:
      "Technical preflight before open_trade: authorization, connection, session, heartbeat, quote freshness, and spread. read-only.",
    inputSchema: {
      symbol: z.string().optional().describe("Pair symbol — for quote/spread check"),
      market: zMarket,
      practice: z.boolean().optional(),
    },
    annotations: READ_ONLY,
    ui: { widget: "trade-readiness" },
  },
  {
    name: "get_agent_capabilities",
    domain: "core",
    description:
      "When: first message in session. serverVersion, featureFlags, EA debounce. read-only. No side-effects.",
    inputSchema: {},
    annotations: READ_ONLY,
  },
  {
    name: "get_portfolio",
    domain: "core",
    description:
      "When: after get_account_overview or to refresh PnL. Balance and summary. read-only. Not for execution.",
    inputSchema: {},
    annotations: READ_ONLY,
    ui: { widget: "portfolio" },
  },
  {
    name: "get_open_trades",
    domain: "core",
    description:
      "When: before evaluate_trade or close. Open trades + summary_ar. read-only.",
    inputSchema: {},
    annotations: READ_ONLY,
    ui: { widget: "open-trades" },
  },
  {
    name: "get_trade_lessons",
    domain: "core",
    description:
      "When: before every analysis or after a loss. Returns structured JSON (result, strategy, market_context.regime, calibrated_confidence) plus summary_ar. recent=true for latest lessons. read-only. Example: symbol=EURUSD&recent=true.",
    inputSchema: {
      symbol: z.string().optional(),
      pattern: z.string().optional(),
      limit: z.number().int().min(1).max(10).optional(),
      recent: z.boolean().optional().describe("Latest lessons regardless of symbol"),
    },
    annotations: READ_ONLY,
    ui: { widget: "lessons-card" },
  },
  {
    name: "run_backtest",
    domain: "core",
    description:
      "When: before trusting a catalog strategy live. Runs deterministic historical backtest for strategy_id/symbol/timeframe/date_range and records server evidence. Uses notional_capital for simulation sizing only (default 10000) — never live broker equity. Not trade execution. Example: strategy_id=ema_trend_follow_v1&symbol=XAUUSD&timeframe=1h.",
    inputSchema: {
      strategy_id: zBacktestStrategyId,
      symbol: zSymbol,
      timeframe: zBacktestTimeframe,
      date_range: z
        .object({
          from: z.string().datetime({ offset: true }),
          to: z.string().datetime({ offset: true }),
        })
        .strict(),
      notional_capital: z
        .number()
        .finite()
        .min(100)
        .max(10_000_000)
        .optional()
        .describe(
          "Simulation capital for historical position sizing only (default 10000). Not live broker equity.",
        ),
    },
    annotations: IDEMPOTENT_WRITE,
  },
  {
    name: "get_strategy_performance",
    domain: "core",
    description:
      "When: after run_backtest or before create_recommendation. Compares live outcomes vs backtest expectation and reports deployment state (shadow/active/suspended). read-only. Example: strategy_id=ema_trend_follow_v1&symbol=EURUSD&timeframe=1h.",
    inputSchema: {
      strategy_id: zBacktestStrategyId,
      symbol: z.string().optional(),
      timeframe: zBacktestTimeframe.optional(),
    },
    annotations: READ_ONLY,
  },
  {
    name: "create_recommendation",
    domain: "core",
    description:
      "When: before open_trade — record recommendation. BUY/SELL require strategy_id, backtested_confidence from get_strategy_performance, market_regime from detect_market_regime, and valid entry/SL/TP. WAIT needs rationale only. Server overwrites confidence with calibrated evidence. side-effect: writes recommendation.",
    inputSchema: createRecommendationCatalogShape,
    annotations: DESTRUCTIVE,
    ui: { widget: "recommendation-card" },
  },
  {
    name: "open_trade",
    domain: "core",
    description:
      "When: after explicit approval. stop_loss is mandatory. Position size is derived server-side from verified broker equity, Risk per Trade, stop distance, and symbol metadata. Rejects unsafe technical execution state. confidence is audit-only.",
    inputSchema: {
      symbol: zSymbol,
      side: zSide,
      market: zMarket,
      entry: z.number().optional(),
      stop_loss: z.number().describe("Stop loss — mandatory, rejected without it"),
      take_profit: z.number().optional(),
      confidence: zConfidence,
      rationale: z.string().min(10),
      recommendation_id: z.number().optional(),
      approved_by_user: z.boolean().optional(),
      practice: z.boolean().optional(),
      market_type: z.literal("spot").optional(),
      order_type: z.enum(["market", "limit"]).optional(),
      limit_price: z.number().positive().optional(),
      idempotencyKey: z.string().max(128).optional().describe("idempotency 24h"),
    },
    annotations: IDEMPOTENT_WRITE,
  },
  {
    name: "close_trade",
    domain: "core",
    description:
      "Close trade · close position · exit · close position · fully exit. When: operator request or after record_exit_decision=close. side-effect: closes trade/all. Example: trade_id=123.",
    inputSchema: {
      trade_id: zTradeId.optional(),
      all: z.boolean().optional(),
    },
    annotations: DESTRUCTIVE,
  },
  {
    name: "evaluate_trade",
    domain: "core",
    description:
      "When: open trade and operator request. Live PnL + context. read-only. Example: trade_id=42.",
    inputSchema: { trade_id: zTradeId },
    annotations: READ_ONLY,
  },
  {
    name: "record_exit_decision",
    domain: "core",
    description:
      "When: after evaluate_trade. audit hold/close/adjust_sl. side-effect: records decision. Does not auto-close.",
    inputSchema: {
      trade_id: zTradeId,
      decision: z.enum(["hold", "close", "adjust_sl"]),
      reason: z.string().min(3).max(500),
      new_stop_loss: z.number().positive().optional(),
    },
    annotations: DESTRUCTIVE,
  },
  {
    name: "request_approval",
    domain: "core",
    description:
      "Request approval · trade approval · send for approval · approval buttons. When: mode=approval. Sends Telegram buttons. side-effect: pending intent. Do not use in direct mode.",
    inputSchema: {
      symbol: zSymbol,
      side: zSide,
      market: zMarket,
      entry: z.number().optional(),
      stop_loss: z.number(),
      take_profit: z.number().optional(),
      confidence: zConfidence.optional(),
      rationale: z.string().optional(),
      recommendation_id: z.number().optional(),
      practice: z.boolean().optional(),
    },
    annotations: DESTRUCTIVE,
  },
  {
    name: "respond_approval",
    domain: "core",
    description:
      "When: pending intent. approve/reject. side-effect: may execute on approve.",
    inputSchema: {
      intent_id: zTradeId,
      action: z.enum(["approve", "reject"]),
    },
    annotations: DESTRUCTIVE,
  },
  {
    name: "get_pending_approvals",
    domain: "core",
    description: "When: mode=approval. List of pending intents. read-only.",
    inputSchema: {},
    annotations: READ_ONLY,
    ui: { widget: "pending-approvals" },
  },
  {
    name: "get_agent_settings",
    domain: "core",
    description:
      "Current fixed product settings: Forex, scalping, and Risk per Trade. read-only.",
    inputSchema: {},
    annotations: READ_ONLY,
  },
  {
    name: "send_telegram_menu",
    domain: "core",
    description:
      "When: outbound notification. side-effect: Telegram message. Not interactive chat.",
    inputSchema: {},
    annotations: DESTRUCTIVE,
  },
  {
    name: "capture_chart_snapshot",
    domain: "core",
    description:
      "When: with every recommendation. PNG inline + drawings. read-only on market; side-effect: capture. Example: symbol=EURUSD&interval=1h.",
    inputSchema: {
      symbol: zSymbol,
      interval: zInterval,
      market: zMarket,
      pattern_name: z.string().optional(),
      chart_drawings: zChartDrawings,
    },
    annotations: READ_ONLY,
  },
  {
    name: "get_recommendation_chart",
    domain: "core",
    description:
      "When: after create_recommendation. PNG chart for recommendation. Old recommendations without chart_image_url may fail — use capture_chart_snapshot for live chart. read-only.",
    inputSchema: { recommendation_id: zTradeId },
    annotations: READ_ONLY,
  },
  {
    name: "list_agent_skills",
    domain: "core",
    description:
      "When: session start (after get_agent_capabilities). Discovers the canonical skill catalogue — metadata only (name, version, category, riskLevel, description). Never loads content. read-only.",
    inputSchema: {},
    annotations: READ_ONLY,
  },
  {
    name: "resolve_agent_skills",
    domain: "core",
    description:
      "When: before answering a trading/analysis request. Discovers the catalogue, selects the most relevant skills for the user request, and returns metadata only (selected + rejected with reasons). Does NOT load bodies — follow with load_agent_skill for each selected name. Prefer this over manually attaching skill files. read-only.",
    inputSchema: {
      request: z
        .string()
        .min(1)
        .max(4000)
        .describe("The operator's current request / message"),
      intents: z
        .array(z.string().min(1).max(64))
        .max(12)
        .optional()
        .describe("Optional soft intent hints (e.g. analysis, recommendation)"),
      locale: z.enum(["ar", "en"]).optional(),
      market: z.string().max(32).optional().describe("Defaults to forex"),
      max_skills: z.number().int().min(1).max(4).optional(),
      allow_execution_skills: z
        .boolean()
        .optional()
        .describe("Only true when execution tools are authorized; still subject to Risk/Execution Guard"),
    },
    annotations: READ_ONLY,
  },
  {
    name: "load_agent_skill",
    domain: "core",
    description:
      "When: after resolve_agent_skills (or when a specific skill is clearly needed). Loads the FULL skill content explicitly and traceably. Fails honestly if missing — never assume a skill was read without a successful load. Skills never grant permissions. read-only.",
    inputSchema: {
      name: z
        .string()
        .min(2)
        .max(64)
        .describe("Skill name from list_agent_skills or resolve_agent_skills"),
      version: z
        .string()
        .max(32)
        .optional()
        .describe("Optional exact version (defaults to latest)"),
    },
    annotations: READ_ONLY,
  },
];

export const CORE_TOOL_BY_NAME = Object.fromEntries(
  CORE_TOOL_DEFINITIONS.map((t) => [t.name, t]),
) as Record<string, ToolDefinition>;
