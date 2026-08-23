import crypto from "crypto";
import { DEFAULT_MARKET, resolveActiveMarket } from "@/lib/marketPolicy";
import { DATA_SYMBOL } from "@/lib/gold";
import {
  execute,
  insertReturningId,
  query,
  queryOne,
  getDbBackend,
} from "./db";
import type { ActivationRule } from "./recommendations/activationRule";
import { deriveExecutionState, type PlanType } from "./agent/trading/tradePlan";
import { hashPassword } from "./auth";
import type { TelegramLoginPayload } from "./telegramAuth";
import { telegramDisplayEmail } from "./telegramAuth";
import type {
  AdminLimits,
  PublicUser,
  Recommendation,
  RecommendationSource,
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
import type { MarketType } from "./markets/types";
import {
  appendRecommendationHistory,
  createCanonicalRecommendation,
} from "./recommendations/canonical";
import { announceOpportunityCreated } from "./recommendations/lifecycleNotifier";

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
  const sym = (symbol ?? DATA_SYMBOL).toUpperCase();
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
  // The account's billing row. 'trial' is the stored name of FREE — an
  // account that has never subscribed; it carries no allowance of its own.
  const created = await execute(
    `INSERT INTO user_entitlements (user_id, plan_status)
     VALUES (?, 'trial')
     ON CONFLICT (user_id) DO NOTHING`,
    [userId],
  );
  // A brand-new account gets its welcome credits here, once. Gating on the
  // insert keeps this off the hot path — every later call sees changes = 0
  // and skips it — while the ledger's UNIQUE key is what actually makes the
  // grant once-ever, whatever calls this.
  if (created.changes > 0) {
    const { ensureSignupGrant } = await import("@/lib/billing/signupGrant");
    await ensureSignupGrant(userId);
  }
}

export async function getSettings(userId: number): Promise<TradingSettings> {
  await ensureUserDefaults(userId);
  const row = (await queryOne<TradingSettings>(
    `SELECT user_id, per_trade_pct, allowed_assets,
            preferred_model_ref, telegram_model_ref, language, send_screenshot, telegram_chat_id,
            onboarding_done, alerts_enabled, alert_trades, alert_signals, updated_at
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
  "preferred_model_ref",
  "telegram_model_ref",
  "language",
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
  can_execute: number;
  claude_quota: number;
  signup_via: "telegram" | "email";
}

export async function listUsersForAdmin(): Promise<AdminUserView[]> {
  return query<AdminUserView>(
    `SELECT u.id, u.email, u.role, u.status, u.username, u.whatsapp_e164,
            u.telegram_id, u.access_expires_at, u.created_at,
            CASE WHEN u.telegram_id IS NOT NULL THEN 'telegram' ELSE 'email' END AS signup_via,
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
    market_regime?: string | null;
    expires_at?: number | null;
    entry_type?: string | null;
    engine_version?: string | null;
    /** The contract's second layer, carried through to the canonical row. */
    plan_type?: string | null;
    /** Where the support came from, distinct from its grade. */
    evidence_source?: string | null;
    /**
     * Which brain produced the decision: 'platform_agent' | 'mcp_client'.
     * Defaults to platform_agent in the canonical creator; the MCP surface
     * passes mcp_client so its record never blends into the platform's own.
     */
    decision_source?: string | null;
    /** The producing model's id when known; null = not declared, never guessed. */
    decision_model?: string | null;
    /**
     * The contract's third layer and the revision-1 seed. This adapter is the
     * MCP surface's only bridge to the canonical creator; before these fields
     * existed it structurally could not carry the plan, which is how MCP rows
     * were stored with every layer-3 column NULL.
     */
    execution_state?: string | null;
    entry_low?: number | null;
    entry_high?: number | null;
    activation_condition?: string | null;
    activation_rule?: ActivationRule | null;
    invalidation_rule?: string | null;
    alternative_scenario?: string | null;
    validity_candles?: number | null;
    evidence?: Record<string, unknown> | null;
    decision_trace?: Record<string, unknown> | null;
  },
): Promise<Recommendation> {
  const action = rec.action === "buy" || rec.action === "sell" ? rec.action : "wait";
  // Derive the third layer when the caller could not: without a live price the
  // derivation fails safe to awaiting_activation, and a conditional plan is
  // forced there regardless. A caller that DID derive (the API route, from a
  // real price) wins.
  const executionState =
    rec.execution_state ??
    (action !== "wait" && rec.plan_type
      ? deriveExecutionState({
          planType: rec.plan_type as PlanType,
          levels:
            rec.entry != null && rec.stop_loss != null && rec.take_profit != null
              ? {
                  entryLow: rec.entry_low ?? rec.entry,
                  entryHigh: rec.entry_high ?? rec.entry,
                  preferredEntry: rec.entry,
                  stopLoss: rec.stop_loss,
                  targets: rec.targets?.length ? rec.targets : [rec.take_profit],
                }
              : null,
          currentPrice: null,
        })
      : null);
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
    marketRegime: rec.market_regime ?? undefined,
    expiresAt: rec.expires_at ?? undefined,
    source: rec.source ?? "web",
    engineVersion: rec.engine_version ?? "aichart-phase4-v1",
    entryType: rec.entry_type ?? undefined,
    planType: rec.plan_type ?? null,
    evidenceSource: rec.evidence_source ?? null,
    decisionSource: rec.decision_source ?? undefined,
    decisionModel: rec.decision_model ?? null,
    executionState,
    initialRevision: {
      entryLow: rec.entry_low ?? null,
      entryHigh: rec.entry_high ?? null,
      activationCondition: rec.activation_condition ?? null,
      activationRule: rec.activation_rule ?? null,
      invalidationRule: rec.invalidation_rule ?? null,
      alternativeScenario: rec.alternative_scenario ?? null,
      validityCandles: rec.validity_candles ?? null,
      evidence: rec.evidence ?? null,
      decisionTrace: rec.decision_trace ?? null,
    },
    rationale: rec.rationale ?? undefined,
    factors: rec.factors ?? undefined,
    chartDrawingsJson: rec.chart_drawings_json ?? undefined,
    patternName: rec.pattern_name ?? undefined,
    analysisTier: rec.analysis_tier ?? undefined,
    contextJson: rec.context_json ?? undefined,
  });
  // MCP `create_recommendation` and every other store write land here. Birth
  // announcements must share the lifecycle (recommendation, event, revision)
  // dedupe with the orchestrator path — otherwise Platform and MCP can each
  // fire once for the same plan. Best-effort: a failed send never undoes the row.
  if (action === "buy" || action === "sell") {
    await announceOpportunityCreated(userId, {
      recommendationId: String(canonical.recommendationId),
      symbol: rec.symbol,
      direction: action,
      entry: rec.entry ?? null,
      planType: rec.plan_type ?? null,
    }).catch(() => {});
  }
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
  trades_total: number;
  trades_open: number;
  intents_pending: number;
  intents_executed: number;
  recommendations_total: number;
  claude_calls_today: number;
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
