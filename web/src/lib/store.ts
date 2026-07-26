import crypto from "crypto";
import { DEFAULT_MARKET, resolveActiveMarket } from "@/lib/marketPolicy";
import {
  execute,
  insertReturningId,
  query,
  queryOne,
  getDbBackend,
} from "./db";
import { encryptSecret, decryptSecret } from "./crypto";
import { hashPassword } from "./auth";
import type { TelegramLoginPayload } from "./telegramAuth";
import { telegramDisplayEmail } from "./telegramAuth";
import type {
  AdminLimits,
  MtAccount,
  MtAccountMeta,
  PublicUser,
  Recommendation,
  RecommendationSource,
  Trade,
  TradeIntent,
  TradingSettings,
  UserRow,
  UserStatus,
} from "./types";
import { normalizeRiskPerTrade } from "./productModel";
import { PUBLIC_USER_COLUMNS } from "./userSelect";
import {
  computeAccessExpiresAt,
  DEFAULT_ACCESS_DAYS,
} from "./platformAccess";
import type { BrokerKind, MarketType, MtPlatform } from "./markets/types";
import {
  forexModeToBrokerKind,
  resolveForexBackendFromPref,
} from "./brokers/forexBackend";
import {
  appendRecommendationHistory,
  createCanonicalRecommendation,
} from "./recommendations/canonical";

/**
 * Broker kind for a user honoring their per-user forex backend choice (EA vs
 * server-side platform), falling back to the global default. Used at the points
 * that route execution (intent/trade creation) so each user's trades go to the
 * backend they picked.
 */
export async function resolveBrokerForMarket(
  userId: number,
  market: MarketType,
): Promise<BrokerKind> {
  if (market !== "forex") {
    throw new Error("Forex-only platform — non-forex markets are not supported.");
  }
  const settings = await getSettings(userId);
  return forexModeToBrokerKind(
    resolveForexBackendFromPref(settings.forex_backend),
  );
}

/** Effective forex backend mode for a user (per-user choice → global default). */
export async function resolveForexBackendForUser(
  userId: number,
): Promise<"ea" | "metaapi" | "mt5local"> {
  const settings = await getSettings(userId);
  return resolveForexBackendFromPref(settings.forex_backend);
}

/** Free-tier starting quota for new self-serve accounts: 3 analyses (cost 4 each). */
export const FREE_TIER_QUOTA = 12;

/* ── Chart layouts (TradingView-style per-user chart URLs + saved state) ── */

export interface ChartLayoutRow {
  id: string;
  user_id: number;
  symbol: string;
  interval: string;
  state_json: string | null;
  updated_at?: string;
}

const LAYOUT_ID_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

function newLayoutId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  let out = "";
  for (const b of bytes) out += LAYOUT_ID_ALPHABET[b % LAYOUT_ID_ALPHABET.length];
  return out;
}

export async function getChartLayoutById(
  id: string,
  userId: number,
): Promise<ChartLayoutRow | null> {
  if (!/^[A-Za-z0-9]{8,16}$/.test(id)) return null;
  return await queryOne<ChartLayoutRow>(
    "SELECT id, user_id, symbol, interval, state_json, updated_at FROM chart_layouts WHERE id = ? AND user_id = ?",
    [id, userId],
  );
}

/** All layouts for a user, newest first (agent/MCP listing). */
export async function listChartLayouts(userId: number): Promise<ChartLayoutRow[]> {
  return query<ChartLayoutRow>(
    "SELECT id, user_id, symbol, interval, state_json, updated_at FROM chart_layouts WHERE user_id = ? ORDER BY updated_at DESC LIMIT 20",
    [userId],
  );
}

/** The user's primary layout — created on first visit. */
export async function getOrCreateChartLayout(
  userId: number,
  symbol?: string,
): Promise<ChartLayoutRow> {
  const existing = await queryOne<ChartLayoutRow>(
    "SELECT id, user_id, symbol, interval, state_json FROM chart_layouts WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1",
    [userId],
  );
  if (existing) return existing;
  const id = newLayoutId();
  const sym = (symbol ?? "EURUSD").toUpperCase();
  await execute(
    "INSERT INTO chart_layouts (id, user_id, symbol) VALUES (?, ?, ?)",
    [id, userId, sym],
  );
  return { id, user_id: userId, symbol: sym, interval: "15m", state_json: null };
}

export async function saveChartLayout(
  id: string,
  userId: number,
  data: { symbol?: string; interval?: string; state?: unknown },
): Promise<boolean> {
  const existing = await getChartLayoutById(id, userId);
  if (!existing) return false;
  await execute(
    `UPDATE chart_layouts
       SET symbol = ?, interval = ?, state_json = ?, updated_at = ${nowExpr()}
     WHERE id = ? AND user_id = ?`,
    [
      (data.symbol ?? existing.symbol).toUpperCase(),
      data.interval ?? existing.interval,
      data.state !== undefined ? JSON.stringify(data.state) : existing.state_json,
      id,
      userId,
    ],
  );
  return true;
}

function nowExpr(): string {
  return process.env.DATABASE_URL ? "NOW()" : "datetime('now')";
}

export async function ensureUserDefaults(userId: number) {
  await execute(
    "INSERT INTO trading_settings (user_id, per_trade_pct) VALUES (?, 1) ON CONFLICT (user_id) DO NOTHING",
    [userId],
  );
  // New accounts start on the free tier; existing rows are untouched (DO NOTHING).
  await execute(
    "INSERT INTO admin_limits (user_id, claude_quota) VALUES (?, ?) ON CONFLICT (user_id) DO NOTHING",
    [userId, FREE_TIER_QUOTA],
  );
  // Canonical subscription trial row — never resets used count on conflict.
  await execute(
    `INSERT INTO user_entitlements (user_id, plan_status, trial_interactions_used, trial_in_flight)
     VALUES (?, 'trial', 0, 0)
     ON CONFLICT (user_id) DO NOTHING`,
    [userId],
  );
}

export async function getSettings(userId: number): Promise<TradingSettings> {
  await ensureUserDefaults(userId);
  const row = (await queryOne<TradingSettings>(
    `SELECT user_id, per_trade_pct, allowed_assets,
            forex_backend, send_screenshot, telegram_chat_id, onboarding_done,
            alerts_enabled, alert_trades, alert_signals, updated_at
       FROM trading_settings
      WHERE user_id = ?`,
    [userId],
  ))!;
  row.per_trade_pct = normalizeRiskPerTrade(row.per_trade_pct);
  return row;
}

export async function getLimits(userId: number): Promise<AdminLimits> {
  await ensureUserDefaults(userId);
  return (await queryOne<AdminLimits>(
    `SELECT user_id, can_execute, claude_quota, updated_at
       FROM admin_limits WHERE user_id = ?`,
    [userId],
  ))!;
}

const SETTABLE_FIELDS = [
  "per_trade_pct",
  "allowed_assets",
  "forex_backend",
  "send_screenshot",
  "telegram_chat_id",
  "onboarding_done",
  "alerts_enabled",
  "alert_trades",
  "alert_signals",
] as const;

export async function updateSettings(
  userId: number,
  patch: Partial<Record<(typeof SETTABLE_FIELDS)[number], unknown>>,
) {
  await ensureUserDefaults(userId);
  const fields = SETTABLE_FIELDS.filter((f) => f in patch);
  if (fields.length === 0) return;
  const assignments = fields.map((f) => `${f} = ?`).join(", ");
  const params: unknown[] = fields.map((f) => {
    const val = patch[f];
    if (getDbBackend() === "postgres") {
      if (
        f === "onboarding_done" ||
        f === "alerts_enabled" ||
        f === "alert_trades" ||
        f === "alert_signals" ||
        f === "send_screenshot"
      ) {
        if (val === 1 || val === "1") return true;
        if (val === 0 || val === "0") return false;
        if (typeof val === "string") return val.toLowerCase() === "true";
        return Boolean(val);
      }
    }
    return val;
  });
  params.push(userId);
  await execute(
    `UPDATE trading_settings SET ${assignments}, updated_at = datetime('now') WHERE user_id = ?`,
    params,
  );
}

export async function saveMtAccount(
  userId: number,
  data: {
    platform: MtPlatform;
    server: string;
    login: string;
    password: string;
    metaapiAccountId: string;
    region?: string | null;
    state?: string;
    connectionStatus?: string | null;
    balance?: number;
    equity?: number;
    currency?: string | null;
  },
) {
  await execute(
    `INSERT INTO mt_accounts (
       user_id, platform, server, login, password_enc, metaapi_account_id,
       region, state, connection_status, balance, equity, currency, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET
       platform = excluded.platform,
       server = excluded.server,
       login = excluded.login,
       password_enc = excluded.password_enc,
       metaapi_account_id = excluded.metaapi_account_id,
       region = excluded.region,
       state = excluded.state,
       connection_status = excluded.connection_status,
       balance = excluded.balance,
       equity = excluded.equity,
       currency = excluded.currency,
       updated_at = datetime('now')`,
    [
      userId,
      data.platform,
      data.server.trim(),
      data.login.replace(/\D/g, ""),
      encryptSecret(data.password),
      data.metaapiAccountId,
      data.region ?? null,
      data.state ?? "CREATED",
      data.connectionStatus ?? null,
      data.balance ?? 0,
      data.equity ?? 0,
      data.currency ?? null,
    ],
  );
}

export async function getMtAccount(userId: number): Promise<MtAccount | null> {
  return queryOne<MtAccount>("SELECT * FROM mt_accounts WHERE user_id = ?", [
    userId,
  ]);
}

export async function getMtAccountMeta(
  userId: number,
): Promise<MtAccountMeta | null> {
  const row = await queryOne<MtAccount>(
    "SELECT * FROM mt_accounts WHERE user_id = ?",
    [userId],
  );
  if (!row) return null;
  const online =
    row.state === "DEPLOYED" && row.connection_status === "CONNECTED";
  return {
    id: row.id,
    platform: row.platform,
    server: row.server,
    login: row.login,
    balance: row.balance,
    equity: row.equity,
    currency: row.currency,
    state: row.state,
    connection_status: row.connection_status,
    online,
    updated_at: row.updated_at,
  };
}

export async function getMtAccountPassword(
  userId: number,
): Promise<string | null> {
  const row = await queryOne<{ password_enc: string }>(
    "SELECT password_enc FROM mt_accounts WHERE user_id = ?",
    [userId],
  );
  if (!row) return null;
  return decryptSecret(row.password_enc);
}

export async function updateMtAccountStatus(
  userId: number,
  patch: {
    state?: string;
    connectionStatus?: string | null;
    balance?: number;
    equity?: number;
    currency?: string | null;
  },
) {
  const fields: string[] = [];
  const params: unknown[] = [];
  if (patch.state != null) {
    fields.push("state = ?");
    params.push(patch.state);
  }
  if (patch.connectionStatus !== undefined) {
    fields.push("connection_status = ?");
    params.push(patch.connectionStatus);
  }
  if (patch.balance != null) {
    fields.push("balance = ?");
    params.push(patch.balance);
  }
  if (patch.equity != null) {
    fields.push("equity = ?");
    params.push(patch.equity);
  }
  if (patch.currency !== undefined) {
    fields.push("currency = ?");
    params.push(patch.currency);
  }
  if (fields.length === 0) return;
  fields.push("updated_at = datetime('now')");
  params.push(userId);
  await execute(
    `UPDATE mt_accounts SET ${fields.join(", ")} WHERE user_id = ?`,
    params,
  );
}

export async function deleteMtAccount(userId: number) {
  await execute("DELETE FROM mt_accounts WHERE user_id = ?", [userId]);
}

export async function getUserByTelegramId(
  telegramId: number,
): Promise<PublicUser | null> {
  return queryOne<PublicUser>(
    `SELECT ${PUBLIC_USER_COLUMNS} FROM users WHERE telegram_id = ?`,
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
  const email = base.toLowerCase();
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
  const tgUsername = payload.username?.replace(/^@/, "").trim();
  const userId = await insertReturningId(
    `INSERT INTO users (email, password_hash, role, status, telegram_id, username)
     VALUES (?, ?, 'user', 'pending', ?, ?)`,
    [email, passwordHash, telegramId, tgUsername || null],
  );
  await ensureUserDefaults(userId);
  await setTelegramChatId(userId, String(telegramId));

  const user = (await getPublicUser(userId))!;
  return { user, isNew: true };
}

export async function getPublicUser(userId: number): Promise<PublicUser | null> {
  return queryOne<PublicUser>(
    `SELECT ${PUBLIC_USER_COLUMNS} FROM users WHERE id = ?`,
    [userId],
  );
}

export async function updateUserProfile(
  userId: number,
  patch: { whatsapp_e164?: string | null },
): Promise<void> {
  if (!("whatsapp_e164" in patch)) return;
  await execute("UPDATE users SET whatsapp_e164 = ? WHERE id = ?", [
    patch.whatsapp_e164 ?? null,
    userId,
  ]);
}

export async function updateUserCredentials(
  userId: number,
  patch: { email: string; password_hash: string },
): Promise<void> {
  await execute("UPDATE users SET email = ?, password_hash = ? WHERE id = ?", [
    patch.email.toLowerCase(),
    patch.password_hash,
    userId,
  ]);
}

export interface AdminUserView extends PublicUser {
  has_mt5: number;
  can_execute: number;
  claude_quota: number;
  signup_via: "telegram" | "email";
}

export async function listUsersForAdmin(): Promise<AdminUserView[]> {
  return query<AdminUserView>(
    `SELECT u.id, u.email, u.role, u.status, u.username, u.whatsapp_e164,
            u.telegram_id, u.access_expires_at, u.created_at,
            CASE WHEN u.telegram_id IS NOT NULL THEN 'telegram' ELSE 'email' END AS signup_via,
            EXISTS (
              SELECT 1 FROM ea_connections ec
              WHERE ec.user_id = u.id AND ec.status != 'revoked'
            ) AS has_mt5,
            COALESCE(a.can_execute, FALSE) AS can_execute,
            COALESCE(a.claude_quota, 1000) AS claude_quota
     FROM users u
     LEFT JOIN admin_limits a ON a.user_id = u.id
     ORDER BY u.created_at DESC`,
  );
}

export async function setUserAccess(
  userId: number,
  patch: {
    status?: UserStatus;
    access_days?: number;
    renew?: boolean;
  },
): Promise<void> {
  const row = await queryOne<UserRow>(
    "SELECT id, role, status, access_expires_at FROM users WHERE id = ?",
    [userId],
  );
  if (!row) return;

  const updates: string[] = [];
  const params: unknown[] = [];

  if (patch.status !== undefined) {
    updates.push("status = ?");
    params.push(patch.status);
    if (patch.status === "pending" || patch.status === "suspended") {
      updates.push("access_expires_at = NULL");
    } else if (patch.status === "active") {
      const days = patch.access_days ?? DEFAULT_ACCESS_DAYS;
      const expires = computeAccessExpiresAt(
        days,
        row.access_expires_at,
        Boolean(patch.renew),
      );
      updates.push("access_expires_at = ?");
      params.push(expires);
    }
  } else if (patch.access_days !== undefined && row.status === "active") {
    const expires = computeAccessExpiresAt(
      patch.access_days,
      row.access_expires_at,
      true,
    );
    updates.push("access_expires_at = ?");
    params.push(expires);
  }

  if (updates.length === 0) return;
  params.push(userId);
  await execute(
    `UPDATE users SET ${updates.join(", ")} WHERE id = ?`,
    params,
  );
}

export async function setUserStatus(userId: number, status: string) {
  await setUserAccess(userId, { status: status as UserStatus });
}

const ADMIN_LIMIT_FIELDS = [
  "can_execute",
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
  const params: unknown[] = fields.map((f) => {
    const val = patch[f];
    if (getDbBackend() === "postgres") {
      if (f === "can_execute") {
        if (val === 1 || val === "1") return true;
        if (val === 0 || val === "0") return false;
        if (typeof val === "string") return val.toLowerCase() === "true";
        return Boolean(val);
      }
    }
    return val;
  });
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
    chart_drawings_json?: string | null;
    pattern_name?: string | null;
    analysis_tier?: string | null;
    context_json?: string | null;
    source?: RecommendationSource;
    market?: MarketType | null;
    analysis_id?: string | null;
    session_id?: string | null;
    chat_id?: string | null;
    targets?: number[] | null;
    risk?: Record<string, unknown> | null;
    backtested_confidence?: number | null;
    confidence_low?: number | null;
    confidence_high?: number | null;
    backtest_id?: number | null;
    market_regime?: string | null;
    strategy_id?: string | null;
    strategy_version?: string | null;
    expires_at?: number | null;
    entry_type?: string | null;
    engine_version?: string | null;
  },
): Promise<Recommendation> {
  const action = rec.action === "buy" || rec.action === "sell" ? rec.action : "wait";
  const canonical = await createCanonicalRecommendation({
    userId,
    analysisId: rec.analysis_id ?? undefined,
    sessionId: rec.session_id ?? undefined,
    chatId: rec.chat_id ?? undefined,
    symbol: rec.symbol,
    market: rec.market ?? "forex",
    timeframe: rec.timeframe ?? undefined,
    direction: action,
    entry: rec.entry,
    stopLoss: rec.stop_loss,
    targets: rec.targets?.length
      ? rec.targets
      : rec.take_profit == null
        ? []
        : [rec.take_profit],
    risk: rec.risk ?? {},
    confidence: rec.confidence,
    backtestedConfidence: rec.backtested_confidence ?? undefined,
    confidenceLow: rec.confidence_low ?? undefined,
    confidenceHigh: rec.confidence_high ?? undefined,
    backtestId: rec.backtest_id ?? undefined,
    marketRegime: rec.market_regime ?? undefined,
    strategyId: rec.strategy_id ?? rec.pattern_name ?? "unspecified",
    strategyVersion: rec.strategy_version ?? "1",
    expiresAt: rec.expires_at ?? undefined,
    source: rec.source ?? "web",
    engineVersion: rec.engine_version ?? "aichart-phase4-v1",
    entryType: rec.entry_type ?? undefined,
    rationale: rec.rationale ?? undefined,
    factors: rec.factors ?? undefined,
    chartDrawingsJson: rec.chart_drawings_json ?? undefined,
    patternName: rec.pattern_name ?? undefined,
    analysisTier: rec.analysis_tier ?? undefined,
    contextJson: rec.context_json ?? undefined,
  });
  return (await queryOne<Recommendation>(
    "SELECT * FROM recommendations WHERE id = ?",
    [canonical.recommendationId],
  ))!;
}

async function appendLegacyRecommendationUpdate(
  id: number,
  kind: "updated" | "drawing_snapshot",
  payload: Record<string, unknown>,
): Promise<void> {
  const owner = await queryOne<{ user_id: number }>(
    "SELECT user_id FROM recommendations WHERE id = ?",
    [id],
  );
  if (!owner) return;
  await appendRecommendationHistory({
    userId: Number(owner.user_id),
    recommendationId: id,
    kind,
    actor: "server",
    source: "legacy-adapter",
    payload,
  });
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
  chartImageUrl: string | null,
): Promise<void> {
  await execute("UPDATE recommendations SET chart_image_url = ? WHERE id = ?", [
    chartImageUrl,
    id,
  ]);
  await appendLegacyRecommendationUpdate(id, "drawing_snapshot", {
    chartImageUrl,
  });
}

export async function updateRecommendationContext(
  id: number,
  contextJson: string,
): Promise<void> {
  await execute("UPDATE recommendations SET context_json = ? WHERE id = ?", [
    contextJson,
    id,
  ]);
  await appendLegacyRecommendationUpdate(id, "updated", {
    contextUpdated: true,
  });
}

export async function updateRecommendationLevels(
  id: number,
  patch: {
    action?: string;
    entry?: number | null;
    stop_loss?: number | null;
    take_profit?: number | null;
    rationale?: string | null;
  },
): Promise<void> {
  const fields: string[] = [];
  const params: unknown[] = [];
  if ("action" in patch) {
    fields.push("action = ?", "direction = ?");
    params.push(patch.action ?? "wait");
    params.push(patch.action ?? "wait");
  }
  if ("entry" in patch) {
    fields.push("entry = ?");
    params.push(patch.entry ?? null);
  }
  if ("stop_loss" in patch) {
    fields.push("stop_loss = ?");
    params.push(patch.stop_loss ?? null);
  }
  if ("take_profit" in patch) {
    fields.push("take_profit = ?", "targets_json = ?");
    params.push(patch.take_profit ?? null);
    params.push(JSON.stringify(patch.take_profit == null ? [] : [patch.take_profit]));
  }
  if ("rationale" in patch) {
    fields.push("rationale = ?");
    params.push(patch.rationale ?? null);
  }
  if (fields.length === 0) return;
  params.push(id);
  await execute(
    `UPDATE recommendations SET ${fields.join(", ")} WHERE id = ?`,
    params,
  );
  await appendLegacyRecommendationUpdate(id, "updated", { levels: patch });
}

export async function updateRecommendationIntelligence(
  id: number,
  patch: {
    memory_refs_json?: string | null;
  },
): Promise<void> {
  const fields: string[] = [];
  const params: unknown[] = [];
  if ("memory_refs_json" in patch) {
    fields.push("memory_refs_json = ?");
    params.push(patch.memory_refs_json ?? null);
  }
  if (fields.length === 0) return;
  params.push(id);
  await execute(
    `UPDATE recommendations SET ${fields.join(", ")} WHERE id = ?`,
    params,
  );
  await appendLegacyRecommendationUpdate(id, "updated", {
    intelligence: {
      memoryRefsUpdated: "memory_refs_json" in patch,
    },
  });
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
     ON CONFLICT(user_id, day) DO UPDATE SET count = claude_usage.count + excluded.count`,
    [userId, today(), by],
  );
}

export async function wouldExceedQuota(
  userId: number,
  cost: number,
): Promise<boolean> {
  if (!isDailyQuotaEnforced()) return false;
  const limits = await getLimits(userId);
  if (limits.claude_quota <= 0) return false;
  return (await getTodayUsage(userId)) + cost > limits.claude_quota;
}

/** When false, daily claude_quota checks are skipped (single-user / unlimited). */
export function isDailyQuotaEnforced(): boolean {
  if (process.env.AICHART_SINGLE_USER === "1") return false;
  return true;
}

export async function createIntent(
  userId: number,
  intent: {
    recommendation_id?: number | null;
    /** Revision of that recommendation these levels came from (CAS at execute). */
    recommendation_revision_no?: number | null;
    /** How this order was authorised: explicit approval or a standing mode. */
    authorization_source?: "user_approved" | "standing_auto" | null;
    symbol: string;
    side: "buy" | "sell";
    notional: number;
    market?: MarketType;
    broker?: BrokerKind;
    entry?: number | null;
    stop_loss?: number | null;
    take_profit?: number | null;
    confidence?: number;
    rationale?: string | null;
    status?: string;
    reason?: string | null;
    practice?: boolean;
    market_type?: "spot" | "futures";
    leverage?: number;
    order_type?: "market" | "limit";
    limit_price?: number | null;
  },
): Promise<TradeIntent> {
  const market: MarketType = resolveActiveMarket(intent.market ?? DEFAULT_MARKET);
  const broker: BrokerKind =
    intent.broker ?? (await resolveBrokerForMarket(userId, market));
  const id = await insertReturningId(
    `INSERT INTO trade_intents
      (user_id, recommendation_id, recommendation_revision_no, authorization_source, symbol, side, notional, market, broker, entry, stop_loss, take_profit, confidence, rationale, status, reason, practice, market_type, leverage, order_type, limit_price)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      userId,
      intent.recommendation_id ?? null,
      intent.recommendation_revision_no ?? null,
      intent.authorization_source ?? null,
      intent.symbol.toUpperCase(),
      intent.side,
      intent.notional,
      market,
      broker,
      intent.entry ?? null,
      intent.stop_loss ?? null,
      intent.take_profit ?? null,
      Math.round(intent.confidence ?? 0),
      intent.rationale ?? null,
      intent.status ?? "pending",
      intent.reason ?? null,
      intent.practice ? 1 : 0,
      intent.market_type ?? "spot",
      intent.leverage ?? 1,
      intent.order_type ?? "market",
      intent.limit_price ?? null,
    ],
  );
  return (await getIntent(id))!;
}

export async function getIntent(
  id: number,
  userId?: number,
): Promise<TradeIntent | null> {
  if (userId != null) {
    return queryOne<TradeIntent>(
      "SELECT * FROM trade_intents WHERE id = ? AND user_id = ?",
      [id, userId],
    );
  }
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
  userId?: number,
): Promise<void> {
  if (userId != null) {
    await execute(
      "UPDATE trade_intents SET status = ?, reason = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?",
      [status, reason ?? null, id, userId],
    );
    return;
  }
  await execute(
    "UPDATE trade_intents SET status = ?, reason = ?, updated_at = datetime('now') WHERE id = ?",
    [status, reason ?? null, id],
  );
}

/**
 * Mark an intent failed and persist the structured technical deny code, so
 * "which rule blocked execution?" is queryable across every path (chat, scalp,
 * monitor) — not only readable from the localized Arabic reason text.
 */
export async function updateIntentDenied(
  id: number,
  reason: string,
  denyCode: string | null,
  userId?: number,
): Promise<void> {
  if (userId != null) {
    await execute(
      "UPDATE trade_intents SET status = 'failed', reason = ?, deny_code = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?",
      [reason, denyCode, id, userId],
    );
    return;
  }
  await execute(
    "UPDATE trade_intents SET status = 'failed', reason = ?, deny_code = ?, updated_at = datetime('now') WHERE id = ?",
    [reason, denyCode, id],
  );
}

export async function updateIntentNotional(
  id: number,
  notional: number,
): Promise<void> {
  await execute(
    "UPDATE trade_intents SET notional = ?, updated_at = datetime('now') WHERE id = ?",
    [notional, id],
  );
}

export async function getRecommendation(
  id: number,
  userId?: number,
): Promise<Recommendation | null> {
  if (userId != null) {
    return queryOne<Recommendation>(
      "SELECT * FROM recommendations WHERE id = ? AND user_id = ?",
      [id, userId],
    );
  }
  return queryOne<Recommendation>(
    "SELECT * FROM recommendations WHERE id = ?",
    [id],
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
    market?: MarketType;
    broker?: BrokerKind;
    status?: string;
    market_type?: "spot" | "futures";
    leverage?: number;
    order_type?: "market" | "limit";
    limit_price?: number | null;
  },
): Promise<Trade> {
  const market: MarketType = resolveActiveMarket(trade.market ?? DEFAULT_MARKET);
  const broker: BrokerKind =
    trade.broker ?? (await resolveBrokerForMarket(userId, market));
  const id = await insertReturningId(
    `INSERT INTO trades
      (user_id, intent_id, symbol, side, qty, quote_qty, avg_price, order_id, env, market, broker, status, market_type, leverage, order_type, limit_price)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      market,
      broker,
      trade.status ?? "open",
      trade.market_type ?? "spot",
      trade.leverage ?? 1,
      trade.order_type ?? "market",
      trade.limit_price ?? null,
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

export async function listOpenTrades(userId: number, limit = 50): Promise<Trade[]> {
  return query<Trade>(
    "SELECT * FROM trades WHERE user_id = ? AND status = 'open' ORDER BY id DESC LIMIT ?",
    [userId, limit],
  );
}

export async function getTrade(
  userId: number,
  tradeId: number,
): Promise<Trade | null> {
  return queryOne<Trade>(
    "SELECT * FROM trades WHERE id = ? AND user_id = ?",
    [tradeId, userId],
  );
}

export async function updateTradeClosed(
  tradeId: number,
  pnl: number,
  userId?: number,
): Promise<void> {
  if (userId != null) {
    await execute(
      `UPDATE trades SET status = 'closed', pnl = ?, closed_at = datetime('now') WHERE id = ? AND user_id = ?`,
      [pnl, tradeId, userId],
    );
    return;
  }
  await execute(
    `UPDATE trades SET status = 'closed', pnl = ?, closed_at = datetime('now') WHERE id = ?`,
    [pnl, tradeId],
  );
}

export async function updateTradeOcoOrderList(
  tradeId: number,
  orderListId: string | number,
): Promise<void> {
  await execute(
    "UPDATE trades SET oco_order_list_id = ? WHERE id = ?",
    [String(orderListId), tradeId],
  );
}

export async function listOpenTradesWithOco(
  userId: number,
  limit = 20,
): Promise<Trade[]> {
  return query<Trade>(
    `SELECT * FROM trades
     WHERE user_id = ? AND status = 'open' AND oco_order_list_id IS NOT NULL
     ORDER BY id ASC LIMIT ?`,
    [userId, limit],
  );
}

export async function countPendingIntents(userId: number): Promise<number> {
  const row = await queryOne<{ n: number }>(
    "SELECT COUNT(*) AS n FROM trade_intents WHERE user_id = ? AND status = 'pending'",
    [userId],
  );
  return row?.n ?? 0;
}

export async function countOpenTrades(userId: number): Promise<number> {
  const row = await queryOne<{ n: number }>(
    "SELECT COUNT(*) AS n FROM trades WHERE user_id = ? AND status IN ('open', 'pending_entry')",
    [userId],
  );
  return row?.n ?? 0;
}

export async function listPendingEntryTrades(
  userId: number,
  limit = 10,
): Promise<Trade[]> {
  return query<Trade>(
    "SELECT * FROM trades WHERE user_id = ? AND status = 'pending_entry' ORDER BY id DESC LIMIT ?",
    [userId, limit],
  );
}

export async function updateTradeEntryFilled(
  tradeId: number,
  qty: number,
  quoteQty: number,
  avgPrice: number,
): Promise<void> {
  await execute(
    `UPDATE trades SET status = 'open', qty = ?, quote_qty = ?, avg_price = ? WHERE id = ?`,
    [qty, quoteQty, avgPrice, tradeId],
  );
}

export async function updateTradeCancelled(tradeId: number): Promise<void> {
  await execute(
    `UPDATE trades SET status = 'cancelled', closed_at = datetime('now') WHERE id = ?`,
    [tradeId],
  );
}

export async function todayRealizedPnlUsd(userId: number): Promise<number> {
  const row = await queryOne<{ pnl: number }>(
    `SELECT COALESCE(SUM(pnl), 0) AS pnl FROM trades
     WHERE user_id = ? AND status = 'closed' AND date(closed_at) = date('now')`,
    [userId],
  );
  return row?.pnl ?? 0;
}

export async function todayRealizedPnlPct(
  userId: number,
  capital: number,
): Promise<number> {
  if (capital <= 0) return 0;
  return ((await todayRealizedPnlUsd(userId)) / capital) * 100;
}

export async function monthRealizedPnlPct(
  userId: number,
  capital: number,
): Promise<number> {
  if (capital <= 0) return 0;
  const row = await queryOne<{ pnl: number }>(
    `SELECT COALESCE(SUM(pnl), 0) AS pnl FROM trades
     WHERE user_id = ? AND status = 'closed'
       AND strftime('%Y-%m', closed_at) = strftime('%Y-%m', 'now')`,
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

export async function recordAlert(
  userId: number,
  alert: {
    type: string;
    title: string;
    body?: string | null;
    symbol?: string | null;
    image_url?: string | null;
    delivered?: boolean;
  },
): Promise<void> {
  await execute(
    `INSERT INTO alert_log (user_id, type, title, body, symbol, image_url, delivered)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      userId,
      alert.type,
      alert.title,
      alert.body ?? null,
      alert.symbol ?? null,
      alert.image_url ?? null,
      alert.delivered ? 1 : 0,
    ],
  );
}

export async function listAlerts(
  userId: number,
  limit = 50,
): Promise<import("./types").AlertLog[]> {
  return query<import("./types").AlertLog>(
    "SELECT * FROM alert_log WHERE user_id = ? ORDER BY id DESC LIMIT ?",
    [userId, limit],
  );
}

export async function clearAlerts(userId: number): Promise<void> {
  await execute("DELETE FROM alert_log WHERE user_id = ?", [userId]);
}

export async function countUnreadAlerts(userId: number): Promise<number> {
  const row = await queryOne<{ n: number }>(
    "SELECT COUNT(*) AS n FROM alert_log WHERE user_id = ? AND read_at IS NULL",
    [userId],
  );
  return row?.n ?? 0;
}

export async function markAlertsRead(
  userId: number,
  ids?: number[],
): Promise<void> {
  if (ids?.length) {
    const placeholders = ids.map(() => "?").join(", ");
    await execute(
      `UPDATE alert_log SET read_at = datetime('now')
       WHERE user_id = ? AND id IN (${placeholders}) AND read_at IS NULL`,
      [userId, ...ids],
    );
    return;
  }
  await execute(
    "UPDATE alert_log SET read_at = datetime('now') WHERE user_id = ? AND read_at IS NULL",
    [userId],
  );
}

/** Agent-originated audit entries (bridge actions) for the activity timeline. */
export async function listAgentAuditLogs(
  userId: number,
  limit = 50,
): Promise<
  { id: number; action: string; detail: string | null; created_at: string }[]
> {
  return query<{
    id: number;
    action: string;
    detail: string | null;
    created_at: string;
  }>(
    `SELECT id, action, detail, created_at FROM audit_logs
     WHERE user_id = ? AND action LIKE 'agent\\_%' ESCAPE '\\'
     ORDER BY id DESC LIMIT ?`,
    [userId, limit],
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
     WHERE u.status = 'active' AND u.role IN ('user', 'admin')
       AND s.onboarding_done = 1`,
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

const TRADE_FAIL_BRAKE_MINUTES = 15;

/**
 * True when the agent already failed to open a trade on this symbol recently.
 * Failed agent_trade_open audit entries embed the denial reason in
 * parentheses (see /api/agent/trade/open), so we match on that marker.
 * Stops wasted AI retry loops hammering the same denied symbol.
 */
export async function hasRecentTradeOpenFailure(
  userId: number,
  symbol: string,
): Promise<boolean> {
  const row = await queryOne<{ id: number }>(
    `SELECT id FROM audit_logs
     WHERE user_id = ? AND action = 'agent_trade_open'
       AND detail LIKE ? AND detail LIKE '%(%'
       AND created_at > datetime('now', ?)
     ORDER BY id DESC LIMIT 1`,
    [
      userId,
      `${symbol.toUpperCase()} %`,
      `-${TRADE_FAIL_BRAKE_MINUTES} minutes`,
    ],
  );
  return Boolean(row);
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
  users_with_mt5: number;
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

  const withMt5 = (await queryOne<{ n: number }>(
    "SELECT COUNT(DISTINCT user_id) AS n FROM ea_connections WHERE status != 'revoked'",
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
    users_with_mt5: withMt5.n,
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
