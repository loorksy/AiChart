import type { ChartDrawing } from "./chartDrawings";
import type { MarketType } from "./markets/types";

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

export interface TradingSettings {
  user_id: number;
  /** Canonical Risk per Trade percentage. Used for position sizing only. */
  per_trade_pct: number;
  /** Stored watchlist/scan assets. Never an analytical or execution gate. */
  allowed_assets: string;
  /**
   * "provider/model" the user chose for their own analyses (e.g.
   * "openai/gpt-5.6-sol", "anthropic/claude-opus-5"). null = platform default.
   * The admin supplies the API keys; the user picks which brain answers.
   */
  preferred_model_ref?: string | null;
  /** The account's language for every surface. NULL = platform default. */
  language?: string | null;
  /** Telegram surface model pick — independent of the platform composer pick. */
  telegram_model_ref?: string | null;
  send_screenshot: number;
  telegram_chat_id: string | null;
  onboarding_done: number;
  alerts_enabled: number;
  alert_trades: number;
  alert_signals: number;
  /** Browser/mobile push channel. Defaults on; independent of Telegram. */
  alert_push?: number;
  /**
   * JSON string array of favourite pair spellings. Broker case is preserved
   * when the cloud pipe is active — the picker pins these above everything else.
   */
  favourite_symbols?: string;
  updated_at: string;
}

export interface AdminLimits {
  user_id: number;
  /** Technical authorization to submit orders. Not recommendation authority. */
  can_execute: number;
  claude_quota: number;
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
  market_regime?: string | null;
  entry: number | null;
  stop_loss: number | null;
  take_profit: number | null;
  /** Full TP ladder when the chart payload carries it (not just take_profit = TP1). */
  targets?: number[];
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
  /** IDs of trade_lessons referenced during analysis (JSON array). */
  memory_refs_json: string | null;
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

export type IntentStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "executed"
  | "failed"
  | "expired";

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

/** Per-symbol contract spec reported by the broker. */
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
  /** instant | market | exchange | request — from SYMBOL_TRADE_EXECUTION. */
  trade_execution?: string;
  /** Broker-supported filling flags, e.g. ioc|fok|return. */
  filling_mode?: string;
  /** Current spread in points. */
  spread_points?: number;
}
