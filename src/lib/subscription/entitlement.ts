import { execute, queryOne } from "@/lib/db";
import type { PublicUser } from "@/lib/types";
import {
  type EntitlementSnapshot,
  type PlanStatus,
  type TrialConfig,
} from "@/lib/subscription/plan";
import { getBillingPlan } from "@/lib/billing/planConfig";

export type UserEntitlementRow = {
  user_id: number;
  plan_status: PlanStatus;
  trial_interactions_used: number;
  trial_in_flight: number;
  trial_started_at: string | null;
  trial_recommendations_used: number;
  subscription_expires_at: string | null;
  activated_at: string | null;
  activated_by: number | null;
  note: string | null;
  updated_at: string;
};

function nowExpr(): string {
  return process.env.DATABASE_URL ? "NOW()" : "datetime('now')";
}

function isExpired(expiresAt: string | null | undefined): boolean {
  if (!expiresAt) return false;
  const t = new Date(expiresAt).getTime();
  return Number.isFinite(t) && t <= Date.now();
}

/** The admin-set trial bounds (billing_plan). 0 duration = no clock. */
export async function loadTrialConfig(): Promise<TrialConfig> {
  const plan = await getBillingPlan();
  return {
    trialLimit: Math.max(0, plan.trial_recommendations | 0),
    trialDurationMs: Math.max(0, plan.trial_duration_minutes | 0) * 60_000,
  };
}

export async function ensureEntitlementRow(userId: number): Promise<UserEntitlementRow> {
  await execute(
    `INSERT INTO user_entitlements (user_id, plan_status, trial_interactions_used, trial_in_flight)
     VALUES (?, 'trial', 0, 0)
     ON CONFLICT (user_id) DO NOTHING`,
    [userId],
  );
  const row = await queryOne<UserEntitlementRow>(
    `SELECT user_id, plan_status, trial_interactions_used, trial_in_flight,
            trial_started_at, trial_recommendations_used,
            subscription_expires_at, activated_at, activated_by, note, updated_at
       FROM user_entitlements WHERE user_id = ?`,
    [userId],
  );
  if (!row) {
    throw new Error("entitlement_missing");
  }
  return row;
}

export async function getEntitlementRow(userId: number): Promise<UserEntitlementRow> {
  return ensureEntitlementRow(userId);
}

export function resolveEntitlement(
  user: Pick<PublicUser, "id" | "role" | "status">,
  row: UserEntitlementRow,
  cfg: TrialConfig,
): EntitlementSnapshot {
  const isAdmin = user.role === "admin";
  if (isAdmin) {
    return {
      role: "admin",
      planStatus: "active",
      isAdmin: true,
      hasPaidAccess: true,
      trialUsed: 0,
      trialRemaining: cfg.trialLimit,
      trialLimit: cfg.trialLimit,
      trialStartedAt: null,
      trialExpiresAt: null,
      expiresAt: null,
      access: "admin",
    };
  }

  if (user.status === "suspended" || row.plan_status === "suspended") {
    return {
      role: "user",
      planStatus: "suspended",
      isAdmin: false,
      hasPaidAccess: false,
      trialUsed: row.trial_recommendations_used,
      trialRemaining: 0,
      trialLimit: cfg.trialLimit,
      trialStartedAt: row.trial_started_at,
      trialExpiresAt: null,
      expiresAt: row.subscription_expires_at,
      access: "blocked",
    };
  }

  let planStatus = row.plan_status;
  if (planStatus === "active" && isExpired(row.subscription_expires_at)) {
    planStatus = "expired";
  }

  if (planStatus === "active") {
    return {
      role: "user",
      planStatus: "active",
      isAdmin: false,
      hasPaidAccess: true,
      trialUsed: row.trial_recommendations_used,
      trialRemaining: cfg.trialLimit,
      trialLimit: cfg.trialLimit,
      trialStartedAt: row.trial_started_at,
      trialExpiresAt: null,
      expiresAt: row.subscription_expires_at,
      access: "full",
    };
  }

  if (planStatus === "expired") {
    return {
      role: "user",
      planStatus: "expired",
      isAdmin: false,
      hasPaidAccess: false,
      trialUsed: row.trial_recommendations_used,
      trialRemaining: 0,
      trialLimit: cfg.trialLimit,
      trialStartedAt: row.trial_started_at,
      trialExpiresAt: null,
      expiresAt: row.subscription_expires_at,
      access: "blocked",
    };
  }

  // The trial carries EVERY feature but dies on whichever cap hits first:
  // the one-hour clock (once started) or the third recommendation. Before
  // the clock starts the user can sign in and browse; the hour begins when
  // startTrialClock runs.
  const used = Math.max(0, row.trial_recommendations_used | 0);
  const remaining = Math.max(0, cfg.trialLimit - used);
  const startedMs = row.trial_started_at ? new Date(row.trial_started_at).getTime() : null;
  // The wall clock is an OPTIONAL admin knob (billing_plan), off by default:
  // with duration 0 the trial is bounded by the recommendation count alone.
  const expiresMs =
    cfg.trialDurationMs > 0 && startedMs != null && Number.isFinite(startedMs)
      ? startedMs + cfg.trialDurationMs
      : null;
  const clockDead = expiresMs != null && Date.now() >= expiresMs;
  return {
    role: "user",
    planStatus: "trial",
    isAdmin: false,
    hasPaidAccess: false,
    trialUsed: used,
    trialRemaining: remaining,
    trialLimit: cfg.trialLimit,
    trialStartedAt: row.trial_started_at,
    trialExpiresAt: expiresMs != null ? new Date(expiresMs).toISOString() : null,
    expiresAt: null,
    access: !clockDead && remaining > 0 ? "trial" : "blocked",
  };
}

/**
 * Start the trial clock — called exactly once. Idempotent: a second call,
 * or a paid account, never move the clock.
 */
export async function startTrialClock(userId: number): Promise<void> {
  await ensureEntitlementRow(userId);
  await execute(
    `UPDATE user_entitlements
        SET trial_started_at = ${nowExpr()}, updated_at = ${nowExpr()}
      WHERE user_id = ? AND plan_status = 'trial' AND trial_started_at IS NULL`,
    [userId],
  );
}

export type TrialRecommendationClaim =
  | { ok: true; mode: "admin" | "paid" | "trial" }
  | { ok: false; reason: "blocked" | "exhausted" };

/**
 * Reserve one trial recommendation. Paid/admin pass untouched; a trial user
 * inside the window gets an ATOMIC increment guarded by the cap, so two
 * concurrent creations cannot mint a fourth recommendation. A failed creation
 * after a successful claim costs the slot — acceptable for a 3-item trial,
 * and far simpler than a reservation ledger.
 *
 * Takes a bare userId and resolves the REAL role/status itself — callers sit
 * in persistence layers that only know the id, and guessing the role here
 * would let an admin burn trial slots (or a suspended user mint one).
 */
export async function claimTrialRecommendation(
  userId: number,
): Promise<TrialRecommendationClaim> {
  const user = await queryOne<Pick<PublicUser, "id" | "role" | "status">>(
    `SELECT id, role, status FROM users WHERE id = ?`,
    [userId],
  );
  if (!user) return { ok: false, reason: "blocked" };
  const cfg = await loadTrialConfig();
  const snapshot = resolveEntitlement(user, await ensureEntitlementRow(user.id), cfg);
  if (snapshot.isAdmin) return { ok: true, mode: "admin" };
  if (snapshot.hasPaidAccess) return { ok: true, mode: "paid" };
  if (snapshot.access !== "trial") return { ok: false, reason: "blocked" };
  const res = await execute(
    `UPDATE user_entitlements
        SET trial_recommendations_used = trial_recommendations_used + 1,
            updated_at = ${nowExpr()}
      WHERE user_id = ? AND plan_status = 'trial'
        AND trial_recommendations_used < ?`,
    [user.id, cfg.trialLimit],
  );
  if (res.changes < 1) return { ok: false, reason: "exhausted" };
  return { ok: true, mode: "trial" };
}

export async function getEntitlementForUser(
  user: Pick<PublicUser, "id" | "role" | "status">,
): Promise<EntitlementSnapshot> {
  const cfg = await loadTrialConfig();
  if (user.role === "admin") {
    return resolveEntitlement(user, {
      user_id: user.id,
      plan_status: "active",
      trial_interactions_used: 0,
      trial_in_flight: 0,
      trial_started_at: null,
      trial_recommendations_used: 0,
      subscription_expires_at: null,
      activated_at: null,
      activated_by: null,
      note: null,
      updated_at: "",
    }, cfg);
  }
  const row = await getEntitlementRow(user.id);
  const snap = resolveEntitlement(user, row, cfg);
  if (row.plan_status === "active" && snap.planStatus === "expired") {
    await execute(
      `UPDATE user_entitlements SET plan_status = 'expired', updated_at = ${nowExpr()} WHERE user_id = ?`,
      [user.id],
    );
  }
  return snap;
}

export async function activateSubscription(opts: {
  userId: number;
  adminId: number;
  expiresAt?: string | null;
  note?: string | null;
}): Promise<UserEntitlementRow> {
  await ensureEntitlementRow(opts.userId);
  await execute(
    `UPDATE user_entitlements
        SET plan_status = 'active',
            subscription_expires_at = ?,
            activated_at = ${nowExpr()},
            activated_by = ?,
            note = ?,
            trial_in_flight = 0,
            updated_at = ${nowExpr()}
      WHERE user_id = ?`,
    [opts.expiresAt ?? null, opts.adminId, opts.note ?? null, opts.userId],
  );
  return getEntitlementRow(opts.userId);
}

export async function suspendSubscription(opts: {
  userId: number;
  adminId: number;
  note?: string | null;
}): Promise<UserEntitlementRow> {
  await ensureEntitlementRow(opts.userId);
  await execute(
    `UPDATE user_entitlements
        SET plan_status = 'suspended',
            activated_by = ?,
            note = ?,
            trial_in_flight = 0,
            updated_at = ${nowExpr()}
      WHERE user_id = ?`,
    [opts.adminId, opts.note ?? null, opts.userId],
  );
  return getEntitlementRow(opts.userId);
}

export async function restoreTrial(opts: {
  userId: number;
  adminId: number;
  note?: string | null;
}): Promise<UserEntitlementRow> {
  await ensureEntitlementRow(opts.userId);
  await execute(
    `UPDATE user_entitlements
        SET plan_status = 'trial',
            subscription_expires_at = NULL,
            activated_by = ?,
            note = ?,
            trial_in_flight = 0,
            updated_at = ${nowExpr()}
      WHERE user_id = ?`,
    [opts.adminId, opts.note ?? null, opts.userId],
  );
  return getEntitlementRow(opts.userId);
}
