import { getDb } from "./db";
import { encryptSecret, decryptSecret } from "./crypto";
import type {
  AdminLimits,
  BinanceAccountMeta,
  PublicUser,
  Recommendation,
  TradingSettings,
} from "./types";
import type { BinanceEnv } from "./binance";

export function ensureUserDefaults(userId: number) {
  const db = getDb();
  db.prepare(
    "INSERT OR IGNORE INTO trading_settings (user_id) VALUES (?)",
  ).run(userId);
  db.prepare(
    "INSERT OR IGNORE INTO admin_limits (user_id) VALUES (?)",
  ).run(userId);
}

export function getSettings(userId: number): TradingSettings {
  ensureUserDefaults(userId);
  return getDb()
    .prepare("SELECT * FROM trading_settings WHERE user_id = ?")
    .get(userId) as TradingSettings;
}

export function getLimits(userId: number): AdminLimits {
  ensureUserDefaults(userId);
  return getDb()
    .prepare("SELECT * FROM admin_limits WHERE user_id = ?")
    .get(userId) as AdminLimits;
}

const SETTABLE_FIELDS = [
  "mode",
  "approval",
  "experience",
  "style",
  "max_capital",
  "per_trade_pct",
  "max_open_trades",
  "daily_profit_target_pct",
  "daily_loss_limit_pct",
  "monthly_loss_limit_pct",
  "allowed_assets",
  "send_screenshot",
  "telegram_chat_id",
  "kill_switch",
] as const;

export function updateSettings(
  userId: number,
  patch: Partial<Record<(typeof SETTABLE_FIELDS)[number], unknown>>,
) {
  ensureUserDefaults(userId);
  const fields = SETTABLE_FIELDS.filter((f) => f in patch);
  if (fields.length === 0) return;
  const assignments = fields.map((f) => `${f} = @${f}`).join(", ");
  const params: Record<string, unknown> = { user_id: userId };
  for (const f of fields) params[f] = patch[f];
  getDb()
    .prepare(
      `UPDATE trading_settings SET ${assignments}, updated_at = datetime('now') WHERE user_id = @user_id`,
    )
    .run(params);
}

export function saveBinanceAccount(
  userId: number,
  apiKey: string,
  apiSecret: string,
  env: BinanceEnv,
  label?: string,
) {
  getDb()
    .prepare(
      `INSERT INTO binance_accounts (user_id, api_key_enc, api_secret_enc, env, label, updated_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(user_id) DO UPDATE SET
         api_key_enc = excluded.api_key_enc,
         api_secret_enc = excluded.api_secret_enc,
         env = excluded.env,
         label = excluded.label,
         updated_at = datetime('now')`,
    )
    .run(userId, encryptSecret(apiKey), encryptSecret(apiSecret), env, label ?? null);
}

export function getBinanceAccountMeta(
  userId: number,
): BinanceAccountMeta | null {
  const row = getDb()
    .prepare(
      "SELECT user_id, env, label, updated_at FROM binance_accounts WHERE user_id = ?",
    )
    .get(userId) as BinanceAccountMeta | undefined;
  return row ?? null;
}

export function getBinanceCredentials(
  userId: number,
): { apiKey: string; apiSecret: string; env: BinanceEnv } | null {
  const row = getDb()
    .prepare(
      "SELECT api_key_enc, api_secret_enc, env FROM binance_accounts WHERE user_id = ?",
    )
    .get(userId) as
    | { api_key_enc: string; api_secret_enc: string; env: BinanceEnv }
    | undefined;
  if (!row) return null;
  return {
    apiKey: decryptSecret(row.api_key_enc),
    apiSecret: decryptSecret(row.api_secret_enc),
    env: row.env,
  };
}

export function deleteBinanceAccount(userId: number) {
  getDb().prepare("DELETE FROM binance_accounts WHERE user_id = ?").run(userId);
}

export interface AdminUserView extends PublicUser {
  has_binance: number;
  binance_env: string | null;
  can_execute: number;
  max_capital_cap: number;
  max_open_trades_cap: number;
  claude_quota: number;
}

export function listUsersForAdmin(): AdminUserView[] {
  return getDb()
    .prepare(
      `SELECT u.id, u.email, u.role, u.status, u.created_at,
              (b.user_id IS NOT NULL) AS has_binance,
              b.env AS binance_env,
              COALESCE(a.can_execute, 0) AS can_execute,
              COALESCE(a.max_capital_cap, 0) AS max_capital_cap,
              COALESCE(a.max_open_trades_cap, 1) AS max_open_trades_cap,
              COALESCE(a.claude_quota, 1000) AS claude_quota
       FROM users u
       LEFT JOIN binance_accounts b ON b.user_id = u.id
       LEFT JOIN admin_limits a ON a.user_id = u.id
       ORDER BY u.created_at DESC`,
    )
    .all() as AdminUserView[];
}

export function setUserStatus(userId: number, status: string) {
  getDb().prepare("UPDATE users SET status = ? WHERE id = ?").run(status, userId);
}

const ADMIN_LIMIT_FIELDS = [
  "can_execute",
  "max_capital_cap",
  "max_open_trades_cap",
  "claude_quota",
] as const;

export function updateAdminLimits(
  userId: number,
  patch: Partial<Record<(typeof ADMIN_LIMIT_FIELDS)[number], unknown>>,
) {
  ensureUserDefaults(userId);
  const fields = ADMIN_LIMIT_FIELDS.filter((f) => f in patch);
  if (fields.length === 0) return;
  const assignments = fields.map((f) => `${f} = @${f}`).join(", ");
  const params: Record<string, unknown> = { user_id: userId };
  for (const f of fields) params[f] = patch[f];
  getDb()
    .prepare(
      `UPDATE admin_limits SET ${assignments}, updated_at = datetime('now') WHERE user_id = @user_id`,
    )
    .run(params);
}

// ─── Recommendations ────────────────────────────────────────────────

export function saveRecommendation(
  userId: number,
  rec: {
    symbol: string;
    action: string;
    confidence: number;
    entry?: number | null;
    stop_loss?: number | null;
    take_profit?: number | null;
    timeframe?: string | null;
    rationale?: string | null;
  },
): Recommendation {
  const info = getDb()
    .prepare(
      `INSERT INTO recommendations
         (user_id, symbol, action, confidence, entry, stop_loss, take_profit, timeframe, rationale)
       VALUES (@user_id, @symbol, @action, @confidence, @entry, @stop_loss, @take_profit, @timeframe, @rationale)`,
    )
    .run({
      user_id: userId,
      symbol: rec.symbol.toUpperCase(),
      action: rec.action,
      confidence: Math.round(rec.confidence) || 0,
      entry: rec.entry ?? null,
      stop_loss: rec.stop_loss ?? null,
      take_profit: rec.take_profit ?? null,
      timeframe: rec.timeframe ?? null,
      rationale: rec.rationale ?? null,
    });
  return getDb()
    .prepare("SELECT * FROM recommendations WHERE id = ?")
    .get(Number(info.lastInsertRowid)) as Recommendation;
}

export function listRecommendations(
  userId: number,
  limit = 20,
): Recommendation[] {
  return getDb()
    .prepare(
      "SELECT * FROM recommendations WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?",
    )
    .all(userId, limit) as Recommendation[];
}

// ─── Claude usage / quota ───────────────────────────────────────────

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function getTodayUsage(userId: number): number {
  const row = getDb()
    .prepare("SELECT count FROM claude_usage WHERE user_id = ? AND day = ?")
    .get(userId, today()) as { count: number } | undefined;
  return row?.count ?? 0;
}

export function incrementUsage(userId: number, by = 1): void {
  getDb()
    .prepare(
      `INSERT INTO claude_usage (user_id, day, count) VALUES (?, ?, ?)
       ON CONFLICT(user_id, day) DO UPDATE SET count = count + excluded.count`,
    )
    .run(userId, today(), by);
}
