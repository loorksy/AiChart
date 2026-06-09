import crypto from "crypto";
import {
  execute,
  insertReturningId,
  query,
  queryOne,
  transaction,
} from "./db";
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

export async function ensureUserDefaults(userId: number) {
  await execute(
    "INSERT INTO trading_settings (user_id) VALUES (?) ON CONFLICT (user_id) DO NOTHING",
    [userId],
  );
  await execute(
    "INSERT INTO admin_limits (user_id) VALUES (?) ON CONFLICT (user_id) DO NOTHING",
    [userId],
  );
}

export async function getSettings(userId: number): Promise<TradingSettings> {
  await ensureUserDefaults(userId);
  return (await queryOne<TradingSettings>(
    "SELECT * FROM trading_settings WHERE user_id = ?",
    [userId],
  ))!;
}

export async function getLimits(userId: number): Promise<AdminLimits> {
  await ensureUserDefaults(userId);
  return (await queryOne<AdminLimits>(
    "SELECT * FROM admin_limits WHERE user_id = ?",
    [userId],
  ))!;
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

export async function updateSettings(
  userId: number,
  patch: Partial<Record<(typeof SETTABLE_FIELDS)[number], unknown>>,
) {
  await ensureUserDefaults(userId);
  const fields = SETTABLE_FIELDS.filter((f) => f in patch);
  if (fields.length === 0) return;
  const assignments = fields.map((f) => `${f} = ?`).join(", ");
  const params: unknown[] = fields.map((f) => patch[f]);
  params.push(userId);
  await execute(
    `UPDATE trading_settings SET ${assignments}, updated_at = datetime('now') WHERE user_id = ?`,
    params,
  );
}

export async function saveBinanceAccount(
  userId: number,
  apiKey: string,
  apiSecret: string,
  env: BinanceEnv,
  label?: string,
) {
  await execute(
    `INSERT INTO binance_accounts (user_id, api_key_enc, api_secret_enc, env, label, updated_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET
       api_key_enc = excluded.api_key_enc,
       api_secret_enc = excluded.api_secret_enc,
       env = excluded.env,
       label = excluded.label,
       updated_at = datetime('now')`,
    [userId, encryptSecret(apiKey), encryptSecret(apiSecret), env, label ?? null],
  );
}

export async function getBinanceAccountMeta(
  userId: number,
): Promise<BinanceAccountMeta | null> {
  return queryOne<BinanceAccountMeta>(
    "SELECT user_id, env, label, updated_at FROM binance_accounts WHERE user_id = ?",
    [userId],
  );
}

export async function getBinanceCredentials(
  userId: number,
): Promise<{ apiKey: string; apiSecret: string; env: BinanceEnv } | null> {
  const row = await queryOne<{
    api_key_enc: string;
    api_secret_enc: string;
    env: BinanceEnv;
  }>(
    "SELECT api_key_enc, api_secret_enc, env FROM binance_accounts WHERE user_id = ?",
    [userId],
  );
  if (!row) return null;
  return {
    apiKey: decryptSecret(row.api_key_enc),
    apiSecret: decryptSecret(row.api_secret_enc),
    env: row.env,
  };
}

export async function deleteBinanceAccount(userId: number) {
  await execute("DELETE FROM binance_accounts WHERE user_id = ?", [userId]);
}

export async function getUserByTelegramId(
  telegramId: number,
): Promise<PublicUser | null> {
  return queryOne<PublicUser>(
    "SELECT id, email, role, status, created_at FROM users WHERE telegram_id = ?",
    [telegramId],
  );
}

export async function setUserTelegramId(
  userId: number,
  telegramId: number,
): Promise<void> {
  await execute("UPDATE users SET telegram_id = ? WHERE id = ?", [
    telegramId,
    userId,
  ]);
}

async function uniqueTelegramEmail(base: string): Promise<string> {
  let email = base.toLowerCase();
  if (!(await queryOne("SELECT id FROM users WHERE email = ?", [email]))) {
    return email;
  }
  let n = 1;
  while (n < 1000) {
    const candidate = base.replace("@", `+${n}@`).toLowerCase();
    if (!(await queryOne("SELECT id FROM users WHERE email = ?", [candidate]))) {
      return candidate;
    }
    n++;
  }
  return `tg_${crypto.randomBytes(4).toString("hex")}@telegram.user`;
}

/** Login or register via Telegram Login Widget; auto-links bot chat id. */
export async function upsertTelegramUser(
  payload: TelegramLoginPayload,
): Promise<{ user: PublicUser; isNew: boolean }> {
  const telegramId = payload.id;
  const existing = await getUserByTelegramId(telegramId);
  if (existing) {
    await setTelegramChatId(existing.id, String(telegramId));
    return { user: existing, isNew: false };
  }

  const email = await uniqueTelegramEmail(telegramDisplayEmail(payload));
  const passwordHash = hashPassword(crypto.randomBytes(32).toString("hex"));
  const userId = await insertReturningId(
    `INSERT INTO users (email, password_hash, role, status, telegram_id)
     VALUES (?, ?, 'user', 'pending', ?)`,
    [email, passwordHash, telegramId],
  );
  await ensureUserDefaults(userId);
  await setTelegramChatId(userId, String(telegramId));

  const user = (await getPublicUser(userId))!;
  return { user, isNew: true };
}

export async function getPublicUser(userId: number): Promise<PublicUser | null> {
  return queryOne<PublicUser>(
    "SELECT id, email, role, status, created_at FROM users WHERE id = ?",
    [userId],
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

export async function listUsersForAdmin(): Promise<AdminUserView[]> {
  return query<AdminUserView>(
    `SELECT u.id, u.email, u.role, u.status, u.created_at,
            (b.user_id IS NOT NULL) AS has_binance,
            b.env AS binance_env,
            COALESCE(a.can_execute, FALSE) AS can_execute,
            COALESCE(a.max_capital_cap, 0) AS max_capital_cap,
            COALESCE(a.max_open_trades_cap, 1) AS max_open_trades_cap,
            COALESCE(a.claude_quota, 1000) AS claude_quota
     FROM users u
     LEFT JOIN binance_accounts b ON b.user_id = u.id
     LEFT JOIN admin_limits a ON a.user_id = u.id
     ORDER BY u.created_at DESC`,
  );
}

export async function setUserStatus(userId: number, status: string) {
  await execute("UPDATE users SET status = ? WHERE id = ?", [status, userId]);
}

const ADMIN_LIMIT_FIELDS = [
  "can_execute",
  "max_capital_cap",
  "max_open_trades_cap",
  "claude_quota",
] as const;

export async function updateAdminLimits(
  userId: number,
  patch: Partial<Record<(typeof ADMIN_LIMIT_FIELDS)[number], unknown>>,
) {
  await ensureUserDefaults(userId);
  const fields = ADMIN_LIMIT_FIELDS.filter((f) => f in patch);
  if (fields.length === 0) return;
  const assignments = fields.map((f) => `${f} = ?`).join(", ");
  const params: unknown[] = fields.map((f) => patch[f]);
  params.push(userId);
  await execute(
    `UPDATE admin_limits SET ${assignments}, updated_at = datetime('now') WHERE user_id = ?`,
    params,
  );
}

export async function saveRecommendation(
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
): Promise<Recommendation> {
  const id = await insertReturningId(
    `INSERT INTO recommendations
       (user_id, symbol, action, confidence, entry, stop_loss, take_profit, timeframe, rationale, factors)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      userId,
      rec.symbol.toUpperCase(),
      rec.action,
      Math.round(rec.confidence) || 0,
      rec.entry ?? null,
      rec.stop_loss ?? null,
      rec.take_profit ?? null,
      rec.timeframe ?? null,
      rec.rationale ?? null,
      rec.factors && rec.factors.length ? JSON.stringify(rec.factors) : null,
    ],
  );
  return (await queryOne<Recommendation>(
    "SELECT * FROM recommendations WHERE id = ?",
    [id],
  ))!;
}

export async function listRecommendations(
  userId: number,
  limit = 20,
): Promise<Recommendation[]> {
  return query<Recommendation>(
    "SELECT * FROM recommendations WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?",
    [userId, limit],
  );
}

export async function updateRecommendationChartUrl(
  id: number,
  chartImageUrl: string,
): Promise<void> {
  await execute("UPDATE recommendations SET chart_image_url = ? WHERE id = ?", [
    chartImageUrl,
    id,
  ]);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function getTodayUsage(userId: number): Promise<number> {
  const row = await queryOne<{ count: number }>(
    "SELECT count FROM claude_usage WHERE user_id = ? AND day = ?",
    [userId, today()],
  );
  return row?.count ?? 0;
}

export async function incrementUsage(userId: number, by = 1): Promise<void> {
  await execute(
    `INSERT INTO claude_usage (user_id, day, count) VALUES (?, ?, ?)
     ON CONFLICT(user_id, day) DO UPDATE SET count = count + excluded.count`,
    [userId, today(), by],
  );
}

export async function wouldExceedQuota(
  userId: number,
  cost: number,
): Promise<boolean> {
  const limits = await getLimits(userId);
  if (limits.claude_quota <= 0) return false;
  return (await getTodayUsage(userId)) + cost > limits.claude_quota;
}

export async function createIntent(
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
): Promise<TradeIntent> {
  const id = await insertReturningId(
    `INSERT INTO trade_intents
      (user_id, recommendation_id, symbol, side, notional, entry, stop_loss, take_profit, confidence, rationale, status, reason)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      userId,
      intent.recommendation_id ?? null,
      intent.symbol.toUpperCase(),
      intent.side,
      intent.notional,
      intent.entry ?? null,
      intent.stop_loss ?? null,
      intent.take_profit ?? null,
      Math.round(intent.confidence ?? 0),
      intent.rationale ?? null,
      intent.status ?? "pending",
      intent.reason ?? null,
    ],
  );
  return (await getIntent(id))!;
}

export async function getIntent(id: number): Promise<TradeIntent | null> {
  return queryOne<TradeIntent>(
    "SELECT * FROM trade_intents WHERE id = ?",
    [id],
  );
}

export async function listIntents(
  userId: number,
  status?: string,
  limit = 30,
): Promise<TradeIntent[]> {
  if (status) {
    return query<TradeIntent>(
      "SELECT * FROM trade_intents WHERE user_id = ? AND status = ? ORDER BY id DESC LIMIT ?",
      [userId, status, limit],
    );
  }
  return query<TradeIntent>(
    "SELECT * FROM trade_intents WHERE user_id = ? ORDER BY id DESC LIMIT ?",
    [userId, limit],
  );
}

export async function updateIntentStatus(
  id: number,
  status: string,
  reason?: string | null,
): Promise<void> {
  await execute(
    "UPDATE trade_intents SET status = ?, reason = ?, updated_at = datetime('now') WHERE id = ?",
    [status, reason ?? null, id],
  );
}

export async function recordTrade(
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
): Promise<Trade> {
  const id = await insertReturningId(
    `INSERT INTO trades
      (user_id, intent_id, symbol, side, qty, quote_qty, avg_price, order_id, env, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      userId,
      trade.intent_id ?? null,
      trade.symbol.toUpperCase(),
      trade.side,
      trade.qty,
      trade.quote_qty,
      trade.avg_price,
      trade.order_id ?? null,
      trade.env,
      trade.status ?? "open",
    ],
  );
  return (await queryOne<Trade>("SELECT * FROM trades WHERE id = ?", [id]))!;
}

export async function listTrades(userId: number, limit = 50): Promise<Trade[]> {
  return query<Trade>(
    "SELECT * FROM trades WHERE user_id = ? ORDER BY id DESC LIMIT ?",
    [userId, limit],
  );
}

export async function countOpenTrades(userId: number): Promise<number> {
  const row = await queryOne<{ n: number }>(
    "SELECT COUNT(*) AS n FROM trades WHERE user_id = ? AND status = 'open'",
    [userId],
  );
  return row?.n ?? 0;
}

export async function todayRealizedPnlPct(
  userId: number,
  capital: number,
): Promise<number> {
  if (capital <= 0) return 0;
  const row = await queryOne<{ pnl: number }>(
    `SELECT COALESCE(SUM(pnl), 0) AS pnl FROM trades
     WHERE user_id = ? AND status = 'closed' AND date(closed_at) = date('now')`,
    [userId],
  );
  return ((row?.pnl ?? 0) / capital) * 100;
}

export async function getFlag(key: string): Promise<string | null> {
  const row = await queryOne<{ value: string }>(
    "SELECT value FROM system_flags WHERE key = ?",
    [key],
  );
  return row?.value ?? null;
}

export async function setFlag(key: string, value: string): Promise<void> {
  await execute(
    `INSERT INTO system_flags (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, value],
  );
}

export async function isMasterKillOn(): Promise<boolean> {
  return (await getFlag("master_kill")) === "1";
}

export async function createLinkCode(userId: number): Promise<string> {
  await execute("DELETE FROM telegram_link_codes WHERE user_id = ?", [userId]);
  const code = crypto.randomBytes(6).toString("hex");
  await execute(
    "INSERT INTO telegram_link_codes (code, user_id) VALUES (?, ?)",
    [code, userId],
  );
  return code;
}

export async function consumeLinkCode(code: string): Promise<number | null> {
  const row = await queryOne<{ user_id: number }>(
    "SELECT user_id FROM telegram_link_codes WHERE code = ? AND created_at > datetime('now','-1 hour')",
    [code],
  );
  if (!row) return null;
  await execute("DELETE FROM telegram_link_codes WHERE code = ?", [code]);
  return row.user_id;
}

export async function setTelegramChatId(
  userId: number,
  chatId: string,
): Promise<void> {
  await ensureUserDefaults(userId);
  await execute(
    "UPDATE trading_settings SET telegram_chat_id = ?, updated_at = datetime('now') WHERE user_id = ?",
    [chatId, userId],
  );
}

export async function clearTelegramChatId(userId: number): Promise<void> {
  await execute(
    "UPDATE trading_settings SET telegram_chat_id = NULL WHERE user_id = ?",
    [userId],
  );
}

export async function getUserByTelegramChatId(
  chatId: string,
): Promise<number | null> {
  const row = await queryOne<{ user_id: number }>(
    "SELECT user_id FROM trading_settings WHERE telegram_chat_id = ?",
    [chatId],
  );
  return row?.user_id ?? null;
}

export async function getTelegramChatId(userId: number): Promise<string | null> {
  const row = await queryOne<{ telegram_chat_id: string | null }>(
    "SELECT telegram_chat_id FROM trading_settings WHERE user_id = ?",
    [userId],
  );
  return row?.telegram_chat_id ?? null;
}

export async function logAudit(
  userId: number | null,
  action: string,
  detail?: string | null,
): Promise<void> {
  await execute(
    "INSERT INTO audit_logs (user_id, action, detail) VALUES (?, ?, ?)",
    [userId, action, detail ?? null],
  );
}

export async function listAuditLogs(limit = 100): Promise<
  {
    id: number;
    user_id: number | null;
    action: string;
    detail: string | null;
    created_at: string;
  }[]
> {
  return query<{
    id: number;
    user_id: number | null;
    action: string;
    detail: string | null;
    created_at: string;
  }>(
    "SELECT id, user_id, action, detail, created_at FROM audit_logs ORDER BY id DESC LIMIT ?",
    [limit],
  );
}

export interface MonitorUser {
  id: number;
  settings: TradingSettings;
  limits: AdminLimits;
}

export async function listUsersForMonitor(): Promise<MonitorUser[]> {
  const rows = await query<{ id: number }>(
    `SELECT u.id
     FROM users u
     JOIN trading_settings s ON s.user_id = u.id
     WHERE u.status = 'active' AND u.role = 'user'
       AND s.kill_switch = 0 AND s.onboarding_done = 1`,
  );

  const out: MonitorUser[] = [];
  for (const r of rows) {
    out.push({
      id: r.id,
      settings: await getSettings(r.id),
      limits: await getLimits(r.id),
    });
  }
  return out;
}

const COOLDOWN_HOURS = 4;

export async function isOnCooldown(
  userId: number,
  symbol: string,
): Promise<boolean> {
  const row = await queryOne<{ scanned_at: string }>(
    `SELECT scanned_at FROM scan_cooldowns
     WHERE user_id = ? AND symbol = ?
       AND scanned_at > datetime('now', ?)`,
    [userId, symbol.toUpperCase(), `-${COOLDOWN_HOURS} hours`],
  );
  return Boolean(row);
}

export async function touchScanCooldown(
  userId: number,
  symbol: string,
): Promise<void> {
  await execute(
    `INSERT INTO scan_cooldowns (user_id, symbol, scanned_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(user_id, symbol) DO UPDATE SET scanned_at = datetime('now')`,
    [userId, symbol.toUpperCase()],
  );
}

export async function isOnboardingDone(userId: number): Promise<boolean> {
  await ensureUserDefaults(userId);
  const row = await queryOne<{ onboarding_done: number }>(
    "SELECT onboarding_done FROM trading_settings WHERE user_id = ?",
    [userId],
  );
  return (row?.onboarding_done ?? 0) === 1;
}

export async function completeOnboarding(userId: number): Promise<void> {
  await updateSettings(userId, { onboarding_done: 1 });
}

export async function listUsersForDailySummary(): Promise<
  { id: number; chatId: string }[]
> {
  return query<{ id: number; chatId: string }>(
    `SELECT s.user_id AS id, s.telegram_chat_id AS chatId
     FROM trading_settings s
     JOIN users u ON u.id = s.user_id
     WHERE u.status = 'active' AND s.telegram_chat_id IS NOT NULL
       AND s.onboarding_done = 1`,
  );
}

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

export async function getAdminPlatformStats(): Promise<AdminPlatformStats> {
  const users = (await queryOne<{
    total: number;
    active: number;
    pending: number;
    suspended: number;
  }>(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active,
       SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
       SUM(CASE WHEN status = 'suspended' THEN 1 ELSE 0 END) AS suspended
     FROM users`,
  ))!;

  const withBinance = (await queryOne<{ n: number }>(
    "SELECT COUNT(*) AS n FROM binance_accounts",
  ))!;

  const trades = (await queryOne<{ total: number; open: number }>(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) AS open
     FROM trades`,
  ))!;

  const intents = (await queryOne<{
    pending: number | null;
    executed: number | null;
  }>(
    `SELECT
       SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
       SUM(CASE WHEN status = 'executed' THEN 1 ELSE 0 END) AS executed
     FROM trade_intents`,
  ))!;

  const recs = (await queryOne<{ n: number }>(
    "SELECT COUNT(*) AS n FROM recommendations",
  ))!;

  const claudeToday = (await queryOne<{ n: number }>(
    "SELECT COALESCE(SUM(count), 0) AS n FROM claude_usage WHERE day = ?",
    [today()],
  ))!;

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

export async function listClaudeUsageForAdmin(): Promise<ClaudeUsageRow[]> {
  return query<ClaudeUsageRow>(
    `SELECT u.id AS user_id, u.email, u.status,
            COALESCE(c.count, 0) AS used_today,
            COALESCE(a.claude_quota, 1000) AS quota
     FROM users u
     LEFT JOIN claude_usage c ON c.user_id = u.id AND c.day = ?
     LEFT JOIN admin_limits a ON a.user_id = u.id
     WHERE u.role != 'admin'
     ORDER BY used_today DESC, u.email`,
    [today()],
  );
}

export async function deleteUser(userId: number): Promise<boolean> {
  const result = await execute("DELETE FROM users WHERE id = ?", [userId]);
  return result.changes > 0;
}
