import { execute, queryOne } from "@/lib/db";
import type { PublicUser } from "@/lib/types";
import {
  AICHART_PLAN,
  type EntitlementSnapshot,
  type PlanStatus,
} from "@/lib/subscription/plan";

export type UserEntitlementRow = {
  user_id: number;
  plan_status: PlanStatus;
  trial_interactions_used: number;
  trial_in_flight: number;
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

export async function ensureEntitlementRow(userId: number): Promise<UserEntitlementRow> {
  await execute(
    `INSERT INTO user_entitlements (user_id, plan_status, trial_interactions_used, trial_in_flight)
     VALUES (?, 'trial', 0, 0)
     ON CONFLICT (user_id) DO NOTHING`,
    [userId],
  );
  const row = await queryOne<UserEntitlementRow>(
    `SELECT user_id, plan_status, trial_interactions_used, trial_in_flight,
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
): EntitlementSnapshot {
  const isAdmin = user.role === "admin";
  if (isAdmin) {
    return {
      role: "admin",
      planStatus: "active",
      isAdmin: true,
      hasPaidAccess: true,
      trialUsed: 0,
      trialRemaining: AICHART_PLAN.trialInteractions,
      trialLimit: AICHART_PLAN.trialInteractions,
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
      trialUsed: row.trial_interactions_used,
      trialRemaining: 0,
      trialLimit: AICHART_PLAN.trialInteractions,
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
      trialUsed: row.trial_interactions_used,
      trialRemaining: AICHART_PLAN.trialInteractions,
      trialLimit: AICHART_PLAN.trialInteractions,
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
      trialUsed: row.trial_interactions_used,
      trialRemaining: 0,
      trialLimit: AICHART_PLAN.trialInteractions,
      expiresAt: row.subscription_expires_at,
      access: "blocked",
    };
  }

  const used = Math.max(0, row.trial_interactions_used | 0);
  const remaining = Math.max(0, AICHART_PLAN.trialInteractions - used);
  return {
    role: "user",
    planStatus: "trial",
    isAdmin: false,
    hasPaidAccess: false,
    trialUsed: used,
    trialRemaining: remaining,
    trialLimit: AICHART_PLAN.trialInteractions,
    expiresAt: null,
    access: remaining > 0 ? "trial" : "blocked",
  };
}

export async function getEntitlementForUser(
  user: Pick<PublicUser, "id" | "role" | "status">,
): Promise<EntitlementSnapshot> {
  if (user.role === "admin") {
    return resolveEntitlement(user, {
      user_id: user.id,
      plan_status: "active",
      trial_interactions_used: 0,
      trial_in_flight: 0,
      subscription_expires_at: null,
      activated_at: null,
      activated_by: null,
      note: null,
      updated_at: "",
    });
  }
  const row = await getEntitlementRow(user.id);
  const snap = resolveEntitlement(user, row);
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
