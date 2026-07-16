import { z } from "zod";
import { DESTRUCTIVE, IDEMPOTENT_WRITE, READ_ONLY } from "../registry.js";
import type { ToolDefinition } from "./types.js";
import {
  zChartDrawings,
  zConfidence,
  zInterval,
  zMarket,
  zOptionalConfidence,
  zSide,
  zSymbol,
  zTradeId,
} from "./shapes.js";

export const CORE_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "get_account_overview",
    domain: "core",
    description:
      "When: start of trading session before any decision. Combines risk + portfolio + live. Resilient: if live fails, returns the rest. include_live=false for quick summary without live account. read-only.",
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
    name: "get_risk_status",
    domain: "core",
    description:
      "When: session start or before mode change. kill switch, limits, mode, executionEnv. Do not use instead of get_trade_readiness for immediate forex. read-only. Returns envelope { ok, data }.",
    inputSchema: {},
    annotations: READ_ONLY,
    ui: { widget: "risk-status" },
  },
  {
    name: "get_trade_readiness",
    domain: "core",
    description:
      "When: before open_trade forex or quoteAgeMs>5000. Do not execute if ready=false. read-only. Example: symbol=EURUSD&confidence=85&market=forex.",
    inputSchema: {
      symbol: z.string().optional().describe("Pair symbol — for quote/spread check"),
      market: zMarket,
      confidence: zOptionalConfidence.describe("Proposed confidence — advisory estimate for the agent"),
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
      "When: before every analysis or after a loss. recent=true for recent mistakes. read-only. Example: symbol=EURUSD&recent=true.",
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
    name: "create_recommendation",
    domain: "core",
    description:
      "When: before open_trade — record recommendation. rationale 2–4 sentences in 'we' voice. side-effect: writes recommendation. Example: action=buy&confidence=85.",
    inputSchema: {
      symbol: zSymbol,
      action: z.enum(["buy", "sell", "wait"]),
      confidence: zConfidence,
      rationale: z.string().min(10),
      factors: z.array(z.string()).min(1).max(8),
      entry: z.number().optional(),
      stop_loss: z.number().optional(),
      take_profit: z.number().optional(),
      timeframe: z.string().optional(),
      pattern_name: z.string().optional(),
      chart_drawings: zChartDrawings,
    },
    annotations: DESTRUCTIVE,
    ui: { widget: "recommendation-card" },
  },
  {
    name: "open_trade",
    domain: "core",
    description:
      "When: after explicit approval. stop_loss mandatory (Risk Guard rejects without it); pass entry/take_profit for reward/risk (rejected if below minimum). notional optional — if omitted, size derived from stop distance. Rejects stale quotes. Decision from agent analysis (no confidence threshold — confidence for logging/sizing only). idempotencyKey optional. side-effect: executes via Risk Guard. Example: stop_loss=64000&take_profit=68000&approved_by_user=true.",
    inputSchema: {
      symbol: zSymbol,
      side: zSide,
      notional: z.number().positive().optional(),
      lots: z.number().positive().max(100).optional().describe("forex: explicit lot size (overrides notional)"),
      market: zMarket,
      entry: z.number().optional(),
      stop_loss: z.number().describe("Stop loss — mandatory, rejected without it"),
      take_profit: z.number().optional(),
      confidence: zConfidence,
      rationale: z.string().min(10),
      recommendation_id: z.number().optional(),
      approved_by_user: z.boolean().optional(),
      practice: z.boolean().optional(),
      market_type: z.enum(["spot", "futures"]).optional(),
      leverage: z.number().min(1).max(125).optional(),
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
      notional: z.number().positive().optional(),
      market: zMarket,
      entry: z.number().optional(),
      stop_loss: z.number().optional(),
      take_profit: z.number().optional(),
      confidence: zOptionalConfidence,
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
    name: "get_execution_env",
    domain: "core",
    description: "When: before live trade. demo/live + platforms. read-only.",
    inputSchema: {},
    annotations: READ_ONLY,
  },
  {
    name: "set_execution_env",
    domain: "core",
    description:
      "When: switch demo↔live with approval. side-effect: changes preference. Do not use automatically.",
    inputSchema: { preference: z.enum(["demo", "live"]) },
    annotations: DESTRUCTIVE,
  },
  {
    name: "set_trading_mode",
    domain: "core",
    description:
      "When: switch auto/approval/direct. side-effect: changes mode. direct recommended for chat.",
    inputSchema: { mode: z.enum(["auto", "approval", "direct"]) },
    annotations: DESTRUCTIVE,
  },
  {
    name: "get_agent_settings",
    domain: "core",
    description:
      "When: before futures or market change. active_market, leverage. read-only.",
    inputSchema: {},
    annotations: READ_ONLY,
  },
  {
    name: "set_active_market",
    domain: "core",
    description:
      "When: confirm active market (forex-only platform). side-effect: no-op — always forex.",
    inputSchema: { active_market: z.literal("forex") },
    annotations: DESTRUCTIVE,
  },
  {
    name: "set_futures_enabled",
    domain: "core",
    description:
      "When: never needed — legacy no-op. Futures disabled; platform is forex-only. Always returns futures_enabled=false. read-only.",
    inputSchema: {
      futures_enabled: z.boolean(),
      default_leverage: z.number().min(1).max(125).optional(),
    },
    annotations: DESTRUCTIVE,
  },
  {
    name: "run_trade_maintenance",
    domain: "core",
    description:
      "When: mechanical OCO/TP maintenance. side-effect: may modify orders. Not a substitute for analysis.",
    inputSchema: {},
    annotations: DESTRUCTIVE,
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
    name: "get_trading_style",
    domain: "core",
    description:
      "Current trading style + style list (scalp/day/swing/position). When: session start to show options to user. read-only.",
    inputSchema: {},
    annotations: READ_ONLY,
  },
  {
    name: "set_trading_style",
    domain: "core",
    description:
      "Set trading style · scalp/day/swing/position. When: after asking user. For scalp pass scalp_max_trades (trade cap). side-effect: updates settings. Example: trading_style=scalp&scalp_max_trades=5.",
    inputSchema: {
      trading_style: z.enum(["scalp", "day", "swing", "position"]),
      scalp_max_trades: z
        .number()
        .int()
        .min(0)
        .max(100)
        .optional()
        .describe("Concurrent trade cap — required for scalp"),
      sync_interval: z
        .boolean()
        .optional()
        .describe("Auto-set timeframe based on style"),
    },
    annotations: DESTRUCTIVE,
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
      trading_mode: z
        .string()
        .max(32)
        .optional()
        .describe("Optional trading style hint (scalp/day/swing/position)"),
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
