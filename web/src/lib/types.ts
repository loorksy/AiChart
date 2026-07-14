import type { ChartDrawing } from "./chartDrawings";
import type { MarketType, BrokerKind, MtPlatform } from "./markets/types";

export type Role = "user" | "admin";
export type UserStatus = "pending" | "active" | "suspended";

export interface UserRow {
  id: number;
  email: string;
  password_hash: string;
  role: Role;
  status: UserStatus;
  telegram_id: number | null;
  username: string | null;
  whatsapp_e164: string | null;
  access_expires_at: string | null;
  created_at: string;
}

export interface PublicUser {
  id: number;
  email: string;
  role: Role;
  status: UserStatus;
  username: string | null;
  whatsapp_e164: string | null;
  telegram_id: number | null;
  access_expires_at: string | null;
  created_at: string;
}

/**
 * Trading modes:
 * - auto:     the agent opens/closes trades on its own (Risk Guard gated).
 * - approval: the agent proposes; the operator approves each entry.
 * - direct:   the operator drives; the agent trades only on explicit command.
 * Legacy DB rows may still hold "advisory" — normalized to "approval" on read.
 */
export const TRADING_MODES = ["auto", "approval", "direct"] as const;
export type TradingMode = (typeof TRADING_MODES)[number];

export function normalizeTradingMode(raw: string | null | undefined): TradingMode {
  if (raw === "advisory") return "approval";
  return (TRADING_MODES as readonly string[]).includes(raw ?? "")
    ? (raw as TradingMode)
    : "approval";
}

/**
 * Trading styles — the *cadence* of trading (distinct from `mode`, which is
 * execution authority). Each style bundles a default timeframe, loop speed,
 * trade cap, and TP/SL width. Used by the interactive MCP style selector and
 * the scalp worker.
 */
export const TRADING_STYLES = ["scalp", "day", "swing", "position"] as const;
export type TradingStyle = (typeof TRADING_STYLES)[number];

export function normalizeTradingStyle(
  raw: string | null | undefined,
): TradingStyle {
  return (TRADING_STYLES as readonly string[]).includes(raw ?? "")
    ? (raw as TradingStyle)
    : "day";
}

/** Default analysis interval per trading style. */
export const STYLE_DEFAULT_INTERVAL: Record<TradingStyle, string> = {
  scalp: "1m",
  day: "15m",
  swing: "4h",
  position: "1d",
};

/** Active scalp session state (consumed by the scalp worker). */
export type ScalpStatus = "active" | "paused" | "stopped";

export interface ScalpSession {
  user_id: number;
  /** 1 = running, 0 = not running. Kept in sync with status for legacy reads. */
  active: number;
  /** Lifecycle state for the autonomous session loop. */
  status: ScalpStatus;
  symbol: string;
  market: MarketType;
  interval: string;
  /** Cap on executed entries this session (0 = fall back to max_open_trades). */
  max_trades: number;
  executed_count: number;
  /** Per-trade notional for entries. */
  notional: number;
  /** paper = record decisions only; live = real execution via Risk Guard. */
  execution_mode: "paper" | "live";
  /** Realized PnL accrued during this session (USD). */
  session_pnl: number;
  /** UTC day key (YYYY-MM-DD) for the daily trade counter. */
  day_key: string | null;
  /** Entries executed today (for daily caps). */
  daily_trade_count: number;
  /** Why the session auto-stopped (daily_limit / cap / broker…). */
  stop_reason: string | null;
  started_at: string | null;
  updated_at: string;
}

export interface TradingSettings {
  user_id: number;
  mode: TradingMode;
  approval: "manual" | "delegate";
  experience: "expert" | "beginner";
  style: "conservative" | "balanced" | "aggressive";
  /** Trading cadence (scalp/day/swing/position). Distinct from `mode`. */
  trading_style: TradingStyle;
  /** Max concurrent trades for scalp sessions (0 = use max_open_trades). */
  scalp_max_trades: number;
  /** 1 = agent is allowed to use scalp mode in conversations. */
  scalp_enabled: number;
  /** Execution mode for scalp: paper = log only, live = real orders. */
  scalp_execution_mode: "paper" | "live";
  max_capital: number;
  per_trade_pct: number;
  max_open_trades: number;
  daily_profit_target_pct: number;
  daily_profit_target_usd: number;
  daily_loss_limit_pct: number;
  monthly_loss_limit_pct: number;
  auto_take_profit_usd: number;
  allowed_assets: string;
  active_market: MarketType;
  /**
   * User-chosen forex execution backend: "ea" (bridge on the user's own MT5)
   * or "mt5local" (server-side, no download). null/undefined = the operator's
   * global default (FOREX_BACKEND / MT5_BRIDGE_URL / METAAPI_TOKEN).
   */
  forex_backend?: "ea" | "mt5local" | "metaapi" | null;
  send_screenshot: number;
  telegram_chat_id: string | null;
  /** 1 = riskGuard enforces all risk/permission gates; 0 = full-autonomous. */
  risk_guard_enabled: number;
  onboarding_done: number;
  alerts_enabled: number;
  alert_trades: number;
  alert_signals: number;
  alert_min_confidence: number;
  /** Minimum trade confidence (0–100) enforced by Risk Guard on live execution. */
  min_confidence: number;
  /**
   * Minimum reward:risk ratio enforced as an objective quality gate (e.g. 1 =
   * reject any setup whose target is closer than its stop). This is NOT a
   * confidence threshold — it is trade-quality discipline. Skipped when
   * risk_guard_enabled=0 or when entry/SL/TP are not all known.
   */
  min_rr?: number;
  last_manual_scan_at?: string | null;
  scan_poll_minutes?: number;
  analysis_interval?: string;
  /** demo | live — preferred execution environment for agent + UI. */
  execution_env_preference?: string;
  /** Futures opt-in (legacy column — always disabled on forex-only platform). */
  futures_enabled?: number;
  /** Default leverage for futures intents (capped by admin max_leverage_cap). */
  default_leverage?: number;
  updated_at: string;
}

export interface AdminLimits {
  user_id: number;
  can_execute: number;
  max_capital_cap: number;
  max_open_trades_cap: number;
  claude_quota: number;
  /** Admin hard cap on leverage for futures (default 10x). */
  max_leverage_cap?: number;
  updated_at: string;
}

export interface SessionPayload {
  sub: number;
  email: string;
  role: Role;
}

export type RecommendationAction = "buy" | "sell" | "wait";

/** Who produced a recommendation: web chat/scan vs MCP agent. */
export type RecommendationSource = "web" | "agent";

export interface Recommendation {
  id: number;
  user_id: number;
  analysis_id?: string | null;
  session_id?: string | null;
  chat_id?: string | null;
  symbol: string;
  action: RecommendationAction;
  direction?: RecommendationAction | null;
  entryType?: "market" | "buy_limit" | "buy_stop" | "sell_limit" | "sell_stop";
  confidence: number;
  entry: number | null;
  stop_loss: number | null;
  take_profit: number | null;
  targets_json?: string | null;
  risk_json?: string | null;
  timeframe: string | null;
  rationale: string | null;
  factors: string | null; // JSON array of short reason strings
  chart_image_url: string | null;
  chart_drawings_json: string | null;
  pattern_name: string | null;
  analysis_tier: string | null;
  context_json: string | null;
  source: RecommendationSource;
  /** Market context when the recommendation was created (forex). */
  market: MarketType | null;
  /** Multi-agent committee votes (JSON). */
  committee_json: string | null;
  /** IDs of trade_lessons referenced during analysis (JSON array). */
  memory_refs_json: string | null;
  strategy_id?: string | null;
  strategy_version?: string | null;
  expires_at?: number | null;
  status?: import("./recommendations/canonical/types").RecommendationStatus;
  status_reason?: string | null;
  engine_version?: string | null;
  legacy_tracking_id?: string | null;
  created_at: string;
}

export type TradeLessonOutcome = "win" | "loss" | "breakeven";

export interface TradeLesson {
  id: number;
  user_id: number;
  trade_id: number;
  recommendation_id: number | null;
  symbol: string;
  market: MarketType;
  timeframe: string | null;
  pattern_name: string | null;
  outcome: TradeLessonOutcome;
  pnl: number;
  pnl_pct: number;
  entry_context_json: string | null;
  lesson_ar: string;
  tags_json: string | null;
  /** PostgreSQL pgvector — null in SQLite rows (use embedding_json). */
  embedding: string | null;
  /** SQLite brute-force search payload. */
  embedding_json: string | null;
  created_at: string;
}

export interface TradeLessonMatch extends TradeLesson {
  score: number;
}

export type CommitteeVoteValue = "approve" | "reject" | "wait";

export interface CommitteePersonaVote {
  vote: CommitteeVoteValue;
  confidence: number;
  rationale_ar: string;
}

export interface CommitteeResult {
  aggressive: CommitteePersonaVote;
  riskOfficer: CommitteePersonaVote;
  macro: CommitteePersonaVote;
  summary_ar: string;
  veto: boolean;
  autoBlocked: boolean;
}

export type IntentStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "executed"
  | "failed"
  | "expired";

export interface TradeIntent {
  id: number;
  user_id: number;
  recommendation_id: number | null;
  symbol: string;
  side: "buy" | "sell";
  notional: number;
  market: MarketType;
  broker: BrokerKind;
  entry: number | null;
  stop_loss: number | null;
  take_profit: number | null;
  confidence: number;
  rationale: string | null;
  status: IntentStatus;
  reason: string | null;
  practice: number;
  /** Legacy market type column — spot only on forex-only platform. */
  market_type?: "spot" | "futures";
  /** Leverage multiplier for futures (1 = no leverage). */
  leverage?: number;
  /** 'market' (default) or 'limit' (futures entry). */
  order_type?: "market" | "limit";
  /** Limit entry price (futures limit orders). */
  limit_price?: number | null;
  created_at: string;
  updated_at: string;
}

export interface Conversation {
  id: number;
  user_id: number;
  /** Opaque, non-enumerable slug used in URLs instead of the sequential id. */
  public_id: string;
  title: string;
  summary: string | null;
  archived: number;
  workflow_state?: string | null;
  workflow_context?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ChatMessageRow {
  id: number;
  conversation_id: number;
  role: "user" | "assistant";
  content: string;
  metadata_json: string | null;
  reasoning_summary?: string | null;
  tool_calls_json?: string | null;
  created_at: string;
}

export interface SemanticMemory {
  id: number;
  user_id: number;
  conversation_id: number | null;
  category: string;
  content: string;
  embedding?: string | null;
  embedding_json?: string | null;
  archived: number | boolean;
  created_at: string;
  updated_at: string;
  source?: string | null;
  memory_type?: string | null;
  confidence?: number | null;
  safety_classification?: string | null;
  expires_at?: string | null;
  last_used_at?: string | null;
  use_count?: number | null;
  source_chat_id?: string | null;
  source_message_id?: string | null;
  source_recommendation_id?: string | null;
  source_trade_id?: string | null;
  locale?: string | null;
  symbol?: string | null;
  timeframe?: string | null;
  strategy_id?: string | null;
}

export interface Trade {
  id: number;
  user_id: number;
  intent_id: number | null;
  symbol: string;
  side: string;
  qty: number;
  quote_qty: number;
  avg_price: number;
  order_id: string | null;
  env: string;
  market: MarketType;
  broker: BrokerKind;
  status: string;
  pnl: number;
  oco_order_list_id: string | null;
  /** 'spot' (default) or 'futures'. */
  market_type?: "spot" | "futures";
  /** Leverage used (1 = spot/no leverage). */
  leverage?: number;
  /** 'market' or 'limit'. */
  order_type?: "market" | "limit";
  /** Limit entry price when order_type is limit. */
  limit_price?: number | null;
  created_at: string;
  closed_at: string | null;
}

export type AlertType =
  | "trade_executed"
  | "trade_closed"
  | "trade_failed"
  | "signal";

export interface AlertLog {
  id: number;
  user_id: number;
  type: AlertType;
  title: string;
  body: string | null;
  symbol: string | null;
  image_url?: string | null;
  delivered: number;
  read_at: string | null;
  created_at: string;
}

export type EaStatus = "online" | "offline" | "revoked";

export interface EaConnection {
  id: number;
  user_id: number;
  platform: MtPlatform;
  token_hash: string;
  label: string | null;
  broker_name: string | null;
  account_login: string | null;
  account_currency: string | null;
  balance: number;
  equity: number;
  status: EaStatus;
  symbol_specs_json: string | null;
  last_heartbeat_at: string | null;
  account_trade_mode: string | null;
  positions_json: string | null;
  created_at: string;
  updated_at: string;
}

/** Non-secret EA connection view for the UI. */
export interface EaConnectionMeta {
  id: number;
  platform: MtPlatform;
  label: string | null;
  broker_name: string | null;
  account_login: string | null;
  account_currency: string | null;
  balance: number;
  equity: number;
  status: EaStatus;
  online: boolean;
  last_heartbeat_at: string | null;
  account_trade_mode: string | null;
  /** Consecutive missed heartbeat intervals (0 when fresh). */
  missedHeartbeats?: number;
  /** Seconds the EA has been stably online (debounced). */
  settledOnlineSeconds?: number;
}

export type EaCommandType =
  | "open_market"
  | "close_position"
  | "modify_sl_tp"
  | "draw_and_capture"
  | "clear_chart"
  | "open_pending"
  | "cancel_order"
  | "close_partial"
  | "ensure_symbol"
  | "query_terminal"
  | "get_ohlc"
  | "list_symbols";

/** Payload queued for EA `get_ohlc` commands (v4+). */
export interface EaGetOhlcPayload {
  symbol: string;
  timeframe: string;
  count?: number;
  /** Bar offset back from the most recent bar (history pagination, EA v4.02+). */
  start?: number;
  /** Exact range in epoch seconds — gap-safe history tiling (EA v4.03+). */
  from?: number;
  to?: number;
}

/** One broker symbol from EA `list_symbols` (v4.02+). */
export interface EaBrokerSymbol {
  /** Broker-exact symbol name (e.g. EURUSDm). */
  s: string;
  /** Digits. */
  d: number;
  /** Description. */
  n: string;
}

/** Result acked by EA for `get_ohlc`. */
export interface EaGetOhlcResult {
  symbol: string;
  timeframe: string;
  count: number;
  candles: Array<{
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume?: number;
  }>;
}

/** Payload queued for EA `draw_and_capture` commands. */
export interface EaDrawAndCapturePayload {
  symbol: string;
  interval: string;
  recommendation_id: number;
  capture_key?: string | null;
  entry?: number | null;
  stop_loss?: number | null;
  take_profit?: number | null;
  drawings: ChartDrawing[];
}

/** Payload queued for EA `clear_chart` commands. */
export interface EaClearChartPayload {
  symbol: string;
  interval?: string | null;
  recommendation_id?: number | null;
}

export type EaCommandStatus =
  | "pending"
  | "sent"
  | "acked"
  | "failed"
  | "expired";

export interface EaCommand {
  id: number;
  user_id: number;
  intent_id: number | null;
  command_type: EaCommandType;
  payload_json: string;
  status: EaCommandStatus;
  result_json: string | null;
  created_at: string;
  expires_at: string | null;
  updated_at: string;
}

/** Per-symbol contract spec reported by the EA in heartbeats. */
export interface EaSymbolSpec {
  symbol: string;
  bid?: number;
  ask?: number;
  digits?: number;
  point?: number;
  contract_size?: number;
  tick_value?: number;
  tick_size?: number;
  min_lot?: number;
  max_lot?: number;
  lot_step?: number;
  /** Minimum stop distance in points (SYMBOL_TRADE_STOPS_LEVEL). */
  stops_level?: number;
  freeze_level?: number;
  /** instant | market | exchange | request — from SYMBOL_TRADE_EXECUTION (EA v3.01+). */
  trade_execution?: string;
  /** Broker-supported filling flags, e.g. ioc|fok|return (EA v3.01+). */
  filling_mode?: string;
  /** Current spread in points (EA v3.01+). */
  spread_points?: number;
}

export type MtAccountState =
  | "CREATED"
  | "DEPLOYING"
  | "DEPLOYED"
  | "DEPLOY_FAILED"
  | "UNDEPLOYING"
  | "UNDEPLOYED"
  | "DRAFT"
  | "unknown";

export interface MtAccount {
  id: number;
  user_id: number;
  platform: MtPlatform;
  server: string;
  login: string;
  password_enc: string;
  metaapi_account_id: string;
  region: string | null;
  state: string;
  connection_status: string | null;
  balance: number;
  equity: number;
  currency: string | null;
  updated_at: string;
  created_at: string;
}

/** Non-secret MT account view for the UI (MetaApi bridge). */
export interface MtAccountMeta {
  id: number;
  platform: MtPlatform;
  server: string;
  login: string;
  balance: number;
  equity: number;
  currency: string | null;
  state: string;
  connection_status: string | null;
  online: boolean;
  updated_at: string;
}
