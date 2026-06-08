import crypto from "crypto";
import { getDb } from "./db";
import { encryptSecret, decryptSecret } from "./crypto";
import { hashPassword } from "./auth";
import type { TelegramLoginPayload } from "./telegramAuth";
import { telegramDisplayEmail } from "./telegramAuth";
import type {
  AdminLimits,
  BinanceAccountMeta,
  PublicUser,
  Recommendation,
  Trade,
  TradeIntent,
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
  "onboarding_done",
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

export function getUserByTelegramId(telegramId: number): PublicUser | null {
  return (
    (getDb()
      .prepare(
        "SELECT id, email, role, status, created_at FROM users WHERE telegram_id = ?",
      )
      .get(telegramId) as PublicUser | undefined) ?? null
  );
}

export function setUserTelegramId(userId: number, telegramId: number): void {
  getDb()
    .prepare("UPDATE users SET telegram_id = ? WHERE id = ?")
    .run(telegramId, userId);
}

function uniqueTelegramEmail(base: string): string {
  const db = getDb();
  let email = base.toLowerCase();
  if (!db.prepare("SELECT id FROM users WHERE email = ?").get(email)) {
    return email;
  }
  let n = 1;
  while (n < 1000) {
    const candidate = base.replace("@", `+${n}@`).toLowerCase();
    if (!db.prepare("SELECT id FROM users WHERE email = ?").get(candidate)) {
      return candidate;
    }
    n++;
  }
  return `tg_${crypto.randomBytes(4).toString("hex")}@telegram.user`;
}

/** Login or register via Telegram Login Widget; auto-links bot chat id. */
export function upsertTelegramUser(
  payload: TelegramLoginPayload,
): { user: PublicUser; isNew: boolean } {
  const telegramId = payload.id;
  const existing = getUserByTelegramId(telegramId);
  if (existing) {
    setTelegramChatId(existing.id, String(telegramId));
    return { user: existing, isNew: false };
  }

  const email = uniqueTelegramEmail(telegramDisplayEmail(payload));
  const passwordHash = hashPassword(crypto.randomBytes(32).toString("hex"));
  const info = getDb()
    .prepare(
      `INSERT INTO users (email, password_hash, role, status, telegram_id)
       VALUES (?, ?, 'user', 'pending', ?)`,
    )
    .run(email, passwordHash, telegramId);
  const userId = Number(info.lastInsertRowid);
  ensureUserDefaults(userId);
  setTelegramChatId(userId, String(telegramId));

  const user = getPublicUser(userId)!;
  return { user, isNew: true };
}

export function getPublicUser(userId: number): PublicUser | null {
  return (
    (getDb()
      .prepare(
        "SELECT id, email, role, status, created_at FROM users WHERE id = ?",
      )
      .get(userId) as PublicUser | undefined) ?? null
  );
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
    factors?: string[] | null;
  },
): Recommendation {
  const info = getDb()
    .prepare(
      `INSERT INTO recommendations
         (user_id, symbol, action, confidence, entry, stop_loss, take_profit, timeframe, rationale, factors)
       VALUES (@user_id, @symbol, @action, @confidence, @entry, @stop_loss, @take_profit, @timeframe, @rationale, @factors)`,
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
      factors:
        rec.factors && rec.factors.length ? JSON.stringify(rec.factors) : null,
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

export function updateRecommendationChartUrl(
  id: number,
  chartImageUrl: string,
): void {
  getDb()
    .prepare(
      "UPDATE recommendations SET chart_image_url = ? WHERE id = ?",
    )
    .run(chartImageUrl, id);
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

/** Returns true when adding `cost` would exceed the user's daily Claude quota. */
export function wouldExceedQuota(userId: number, cost: number): boolean {
  const limits = getLimits(userId);
  if (limits.claude_quota <= 0) return false;
  return getTodayUsage(userId) + cost > limits.claude_quota;
}

// ─── Trade intents ──────────────────────────────────────────────────

export function createIntent(
  userId: number,
  intent: {
    recommendation_id?: number | null;
    symbol: string;
    side: "buy" | "sell";
    notional: number;
    entry?: number | null;
    stop_loss?: number | null;
    take_profit?: number | null;
    confidence?: number;
    rationale?: string | null;
    status?: string;
    reason?: string | null;
  },
): TradeIntent {
  const info = getDb()
    .prepare(
      `INSERT INTO trade_intents
        (user_id, recommendation_id, symbol, side, notional, entry, stop_loss, take_profit, confidence, rationale, status, reason)
       VALUES (@user_id, @recommendation_id, @symbol, @side, @notional, @entry, @stop_loss, @take_profit, @confidence, @rationale, @status, @reason)`,
    )
    .run({
      user_id: userId,
      recommendation_id: intent.recommendation_id ?? null,
      symbol: intent.symbol.toUpperCase(),
      side: intent.side,
      notional: intent.notional,
      entry: intent.entry ?? null,
      stop_loss: intent.stop_loss ?? null,
      take_profit: intent.take_profit ?? null,
      confidence: Math.round(intent.confidence ?? 0),
      rationale: intent.rationale ?? null,
      status: intent.status ?? "pending",
      reason: intent.reason ?? null,
    });
  return getIntent(Number(info.lastInsertRowid))!;
}

export function getIntent(id: number): TradeIntent | null {
  return (
    (getDb()
      .prepare("SELECT * FROM trade_intents WHERE id = ?")
      .get(id) as TradeIntent | undefined) ?? null
  );
}

export function listIntents(
  userId: number,
  status?: string,
  limit = 30,
): TradeIntent[] {
  if (status) {
    return getDb()
      .prepare(
        "SELECT * FROM trade_intents WHERE user_id = ? AND status = ? ORDER BY id DESC LIMIT ?",
      )
      .all(userId, status, limit) as TradeIntent[];
  }
  return getDb()
    .prepare(
      "SELECT * FROM trade_intents WHERE user_id = ? ORDER BY id DESC LIMIT ?",
    )
    .all(userId, limit) as TradeIntent[];
}

export function updateIntentStatus(
  id: number,
  status: string,
  reason?: string | null,
): void {
  getDb()
    .prepare(
      "UPDATE trade_intents SET status = ?, reason = ?, updated_at = datetime('now') WHERE id = ?",
    )
    .run(status, reason ?? null, id);
}

// ─── Trades ─────────────────────────────────────────────────────────

export function recordTrade(
  userId: number,
  trade: {
    intent_id?: number | null;
    symbol: string;
    side: string;
    qty: number;
    quote_qty: number;
    avg_price: number;
    order_id?: string | null;
    env: string;
    status?: string;
  },
): Trade {
  const info = getDb()
    .prepare(
      `INSERT INTO trades
        (user_id, intent_id, symbol, side, qty, quote_qty, avg_price, order_id, env, status)
       VALUES (@user_id, @intent_id, @symbol, @side, @qty, @quote_qty, @avg_price, @order_id, @env, @status)`,
    )
    .run({
      user_id: userId,
      intent_id: trade.intent_id ?? null,
      symbol: trade.symbol.toUpperCase(),
      side: trade.side,
      qty: trade.qty,
      quote_qty: trade.quote_qty,
      avg_price: trade.avg_price,
      order_id: trade.order_id ?? null,
      env: trade.env,
      status: trade.status ?? "open",
    });
  return getDb()
    .prepare("SELECT * FROM trades WHERE id = ?")
    .get(Number(info.lastInsertRowid)) as Trade;
}

export function listTrades(userId: number, limit = 50): Trade[] {
  return getDb()
    .prepare(
      "SELECT * FROM trades WHERE user_id = ? ORDER BY id DESC LIMIT ?",
    )
    .all(userId, limit) as Trade[];
}

export function countOpenTrades(userId: number): number {
  const row = getDb()
    .prepare(
      "SELECT COUNT(*) AS n FROM trades WHERE user_id = ? AND status = 'open'",
    )
    .get(userId) as { n: number };
  return row.n;
}

/** Today's realized PnL as a % of the user's capital cap (negative = loss). */
export function todayRealizedPnlPct(userId: number, capital: number): number {
  if (capital <= 0) return 0;
  const row = getDb()
    .prepare(
      `SELECT COALESCE(SUM(pnl), 0) AS pnl FROM trades
       WHERE user_id = ? AND status = 'closed' AND date(closed_at) = date('now')`,
    )
    .get(userId) as { pnl: number };
  return (row.pnl / capital) * 100;
}

// ─── System flags (master kill switch, etc.) ────────────────────────

export function getFlag(key: string): string | null {
  const row = getDb()
    .prepare("SELECT value FROM system_flags WHERE key = ?")
    .get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setFlag(key: string, value: string): void {
  getDb()
    .prepare(
      `INSERT INTO system_flags (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .run(key, value);
}

export function isMasterKillOn(): boolean {
  return getFlag("master_kill") === "1";
}

// ─── Telegram linking ───────────────────────────────────────────────

export function createLinkCode(userId: number): string {
  const db = getDb();
  db.prepare("DELETE FROM telegram_link_codes WHERE user_id = ?").run(userId);
  const code = crypto.randomBytes(6).toString("hex");
  db.prepare(
    "INSERT INTO telegram_link_codes (code, user_id) VALUES (?, ?)",
  ).run(code, userId);
  return code;
}

/** Consumes a link code (valid 1 hour) and returns the owning user id. */
export function consumeLinkCode(code: string): number | null {
  const db = getDb();
  const row = db
    .prepare(
      "SELECT user_id FROM telegram_link_codes WHERE code = ? AND created_at > datetime('now','-1 hour')",
    )
    .get(code) as { user_id: number } | undefined;
  if (!row) return null;
  db.prepare("DELETE FROM telegram_link_codes WHERE code = ?").run(code);
  return row.user_id;
}

export function setTelegramChatId(userId: number, chatId: string): void {
  ensureUserDefaults(userId);
  getDb()
    .prepare(
      "UPDATE trading_settings SET telegram_chat_id = ?, updated_at = datetime('now') WHERE user_id = ?",
    )
    .run(chatId, userId);
}

export function clearTelegramChatId(userId: number): void {
  getDb()
    .prepare(
      "UPDATE trading_settings SET telegram_chat_id = NULL WHERE user_id = ?",
    )
    .run(userId);
}

export function getUserByTelegramChatId(chatId: string): number | null {
  const row = getDb()
    .prepare("SELECT user_id FROM trading_settings WHERE telegram_chat_id = ?")
    .get(chatId) as { user_id: number } | undefined;
  return row?.user_id ?? null;
}

export function getTelegramChatId(userId: number): string | null {
  const row = getDb()
    .prepare("SELECT telegram_chat_id FROM trading_settings WHERE user_id = ?")
    .get(userId) as { telegram_chat_id: string | null } | undefined;
  return row?.telegram_chat_id ?? null;
}

// ─── Audit log ──────────────────────────────────────────────────────

export function logAudit(
  userId: number | null,
  action: string,
  detail?: string | null,
): void {
  getDb()
    .prepare(
      "INSERT INTO audit_logs (user_id, action, detail) VALUES (?, ?, ?)",
    )
    .run(userId, action, detail ?? null);
}

export function listAuditLogs(limit = 100): {
  id: number;
  user_id: number | null;
  action: string;
  detail: string | null;
  created_at: string;
}[] {
  return getDb()
    .prepare(
      "SELECT id, user_id, action, detail, created_at FROM audit_logs ORDER BY id DESC LIMIT ?",
    )
    .all(limit) as {
    id: number;
    user_id: number | null;
    action: string;
    detail: string | null;
    created_at: string;
  }[];
}

// ─── Monitor / cron helpers ─────────────────────────────────────────

export interface MonitorUser {
  id: number;
  settings: TradingSettings;
  limits: AdminLimits;
}

/** Active users eligible for 24/7 market monitoring. */
export function listUsersForMonitor(): MonitorUser[] {
  const rows = getDb()
    .prepare(
      `SELECT u.id
       FROM users u
       JOIN trading_settings s ON s.user_id = u.id
       WHERE u.status = 'active' AND u.role = 'user'
         AND s.kill_switch = 0 AND s.onboarding_done = 1`,
    )
    .all() as { id: number }[];

  return rows.map((r) => ({
    id: r.id,
    settings: getSettings(r.id),
    limits: getLimits(r.id),
  }));
}

const COOLDOWN_HOURS = 4;

export function isOnCooldown(userId: number, symbol: string): boolean {
  const row = getDb()
    .prepare(
      `SELECT scanned_at FROM scan_cooldowns
       WHERE user_id = ? AND symbol = ?
         AND scanned_at > datetime('now', ?)`,
    )
    .get(userId, symbol.toUpperCase(), `-${COOLDOWN_HOURS} hours`) as
    | { scanned_at: string }
    | undefined;
  return Boolean(row);
}

export function touchScanCooldown(userId: number, symbol: string): void {
  getDb()
    .prepare(
      `INSERT INTO scan_cooldowns (user_id, symbol, scanned_at)
       VALUES (?, ?, datetime('now'))
       ON CONFLICT(user_id, symbol) DO UPDATE SET scanned_at = datetime('now')`,
    )
    .run(userId, symbol.toUpperCase());
}

export function isOnboardingDone(userId: number): boolean {
  ensureUserDefaults(userId);
  const row = getDb()
    .prepare("SELECT onboarding_done FROM trading_settings WHERE user_id = ?")
    .get(userId) as { onboarding_done: number } | undefined;
  return (row?.onboarding_done ?? 0) === 1;
}

export function completeOnboarding(userId: number): void {
  updateSettings(userId, { onboarding_done: 1 });
}

/** Users with Telegram linked for daily summaries. */
export function listUsersForDailySummary(): { id: number; chatId: string }[] {
  const rows = getDb()
    .prepare(
      `SELECT s.user_id AS id, s.telegram_chat_id AS chatId
       FROM trading_settings s
       JOIN users u ON u.id = s.user_id
       WHERE u.status = 'active' AND s.telegram_chat_id IS NOT NULL
         AND s.onboarding_done = 1`,
    )
    .all() as { id: number; chatId: string }[];
  return rows;
}

// ─── Admin analytics ────────────────────────────────────────────────

export interface AdminPlatformStats {
  users_total: number;
  users_active: number;
  users_pending: number;
  users_suspended: number;
  users_with_binance: number;
  trades_total: number;
  trades_open: number;
  intents_pending: number;
  intents_executed: number;
  recommendations_total: number;
  claude_calls_today: number;
}

export function getAdminPlatformStats(): AdminPlatformStats {
  const db = getDb();
  const users = db
    .prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active,
         SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
         SUM(CASE WHEN status = 'suspended' THEN 1 ELSE 0 END) AS suspended
       FROM users`,
    )
    .get() as {
    total: number;
    active: number;
    pending: number;
    suspended: number;
  };

  const withBinance = db
    .prepare("SELECT COUNT(*) AS n FROM binance_accounts")
    .get() as { n: number };

  const trades = db
    .prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) AS open
       FROM trades`,
    )
    .get() as { total: number; open: number };

  const intents = db
    .prepare(
      `SELECT
         SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
         SUM(CASE WHEN status = 'executed' THEN 1 ELSE 0 END) AS executed
       FROM trade_intents`,
    )
    .get() as { pending: number | null; executed: number | null };

  const recs = db
    .prepare("SELECT COUNT(*) AS n FROM recommendations")
    .get() as { n: number };

  const claudeToday = db
    .prepare("SELECT COALESCE(SUM(count), 0) AS n FROM claude_usage WHERE day = ?")
    .get(today()) as { n: number };

  return {
    users_total: users.total,
    users_active: users.active,
    users_pending: users.pending,
    users_suspended: users.suspended,
    users_with_binance: withBinance.n,
    trades_total: trades.total,
    trades_open: trades.open,
    intents_pending: intents.pending ?? 0,
    intents_executed: intents.executed ?? 0,
    recommendations_total: recs.n,
    claude_calls_today: claudeToday.n,
  };
}

export interface ClaudeUsageRow {
  user_id: number;
  email: string;
  status: string;
  used_today: number;
  quota: number;
}

export function listClaudeUsageForAdmin(): ClaudeUsageRow[] {
  return getDb()
    .prepare(
      `SELECT u.id AS user_id, u.email, u.status,
              COALESCE(c.count, 0) AS used_today,
              COALESCE(a.claude_quota, 1000) AS quota
       FROM users u
       LEFT JOIN claude_usage c ON c.user_id = u.id AND c.day = ?
       LEFT JOIN admin_limits a ON a.user_id = u.id
       WHERE u.role != 'admin'
       ORDER BY used_today DESC, u.email`,
    )
    .all(today()) as ClaudeUsageRow[];
}

export function deleteUser(userId: number): boolean {
  const info = getDb().prepare("DELETE FROM users WHERE id = ?").run(userId);
  return info.changes > 0;
}
