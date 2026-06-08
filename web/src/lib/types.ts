export type Role = "user" | "admin";
export type UserStatus = "pending" | "active" | "suspended";

export interface UserRow {
  id: number;
  email: string;
  password_hash: string;
  role: Role;
  status: UserStatus;
  created_at: string;
}

export interface PublicUser {
  id: number;
  email: string;
  role: Role;
  status: UserStatus;
  created_at: string;
}

export interface TradingSettings {
  user_id: number;
  mode: "advisory" | "auto";
  approval: "manual" | "delegate";
  experience: "expert" | "beginner";
  style: "conservative" | "balanced" | "aggressive";
  max_capital: number;
  per_trade_pct: number;
  max_open_trades: number;
  daily_profit_target_pct: number;
  daily_loss_limit_pct: number;
  monthly_loss_limit_pct: number;
  allowed_assets: string;
  send_screenshot: number;
  telegram_chat_id: string | null;
  kill_switch: number;
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
  created_at: string;
}

export type IntentStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "executed"
  | "failed";

export interface TradeIntent {
  id: number;
  user_id: number;
  recommendation_id: number | null;
  symbol: string;
  side: "buy" | "sell";
  notional: number;
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
  status: string;
  pnl: number;
  created_at: string;
  closed_at: string | null;
}
