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
  created_at: string;
}

export interface PublicUser {
  id: number;
  email: string;
  role: Role;
  status: UserStatus;
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

export interface TradingSettings {
  user_id: number;
  mode: TradingMode;
  approval: "manual" | "delegate";
  experience: "expert" | "beginner";
  style: "conservative" | "balanced" | "aggressive";
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
  send_screenshot: number;
  telegram_chat_id: string | null;
  kill_switch: number;
  onboarding_done: number;
  alerts_enabled: number;
  alert_trades: number;
  alert_signals: number;
  alert_min_confidence: number;
  last_manual_scan_at?: string | null;
  scan_poll_minutes?: number;
  analysis_interval?: string;
  updated_at: string;
}

export interface AdminLimits {
  user_id: number;
  can_execute: number;
  max_capital_cap: number;
  max_open_trades_cap: number;
  claude_quota: number;
  updated_at: string;
}

export interface BinanceAccountMeta {
  user_id: number;
  env: "testnet" | "prod";
  label: string | null;
  updated_at: string;
}

export interface SessionPayload {
  sub: number;
  email: string;
  role: Role;
}

export type RecommendationAction = "buy" | "sell" | "wait";

/** Who produced a recommendation: web chat/scan vs the OpenClaw agent. */
export type RecommendationSource = "web" | "agent";

export interface Recommendation {
  id: number;
  user_id: number;
  symbol: string;
  action: RecommendationAction;
  confidence: number;
  entry: number | null;
  stop_loss: number | null;
  take_profit: number | null;
  timeframe: string | null;
  rationale: string | null;
  factors: string | null; // JSON array of short reason strings
  chart_image_url: string | null;
  chart_drawings_json: string | null;
  pattern_name: string | null;
  analysis_tier: string | null;
  context_json: string | null;
  source: RecommendationSource;
  created_at: string;
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
  created_at: string;
  updated_at: string;
}

export interface Conversation {
  id: number;
  user_id: number;
  title: string;
  summary: string | null;
  archived: number;
  created_at: string;
  updated_at: string;
}

export interface ChatMessageRow {
  id: number;
  conversation_id: number;
  role: "user" | "assistant";
  content: string;
  metadata_json: string | null;
  created_at: string;
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
}

export type EaCommandType = "open_market" | "close_position" | "modify_sl_tp";

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
