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
