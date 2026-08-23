/**
 * Who this account is, for billing purposes — and nothing else.
 *
 * There are exactly three user states and one admin state:
 *
 *   - **free**    — never subscribed. Spends the SAME credits at the SAME
 *     prices as anyone else; the only thing it starts with is the signup
 *     grant. There is no trial allowance, no trial counter, and no
 *     trial-only code path anywhere in the platform any more.
 *   - **full**    — a live subscription (Pro).
 *   - **blocked** — suspended, or a subscription that lapsed. A lapsed
 *     account keeps its balance frozen: renewal makes the same number
 *     usable again, expiry never spends or deletes it.
 *   - **admin**   — the operator, who is never charged.
 *
 * The stored `plan_status` still spells the free state `'trial'` because a
 * live database uses that value; the word carries no allowance.
 */
import { execute, queryOne } from "@/lib/db";
import type { PublicUser } from "@/lib/types";
import { type EntitlementSnapshot, type PlanStatus } from "@/lib/subscription/plan";

export type UserEntitlementRow = {
  user_id: number;
  plan_status: PlanStatus;
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
    `INSERT INTO user_entitlements (user_id, plan_status)
     VALUES (?, 'trial')
     ON CONFLICT (user_id) DO NOTHING`,
    [userId],
  );
  const row = await queryOne<UserEntitlementRow>(
    `SELECT user_id, plan_status, subscription_expires_at,
            activated_at, activated_by, note, updated_at
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
  if (user.role === "admin") {
    return {
      role: "admin",
      planStatus: "active",
      isAdmin: true,
      hasPaidAccess: true,
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
      expiresAt: row.subscription_expires_at,
      access: "blocked",
    };
  }

  // Free: never subscribed. Not blocked — it simply has no subscription, and
  // whether it can act is a question for the BALANCE, asked by the one spend
  // gate. Answering it here would be a second opinion.
  return {
    role: "user",
    planStatus: "trial",
    isAdmin: false,
    hasPaidAccess: false,
    expiresAt: null,
    access: "free",
  };
}

export async function getEntitlementForUser(
  user: Pick<PublicUser, "id" | "role" | "status">,
): Promise<EntitlementSnapshot> {
  if (user.role === "admin") {
    return resolveEntitlement(user, {
      user_id: user.id,
      plan_status: "active",
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
            updated_at = ${nowExpr()}
      WHERE user_id = ?`,
    [opts.adminId, opts.note ?? null, opts.userId],
  );
  return getEntitlementRow(opts.userId);
}

/** Return an account to FREE (never-subscribed): no plan, no expiry. */
export async function restoreFreeAccount(opts: {
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
            updated_at = ${nowExpr()}
      WHERE user_id = ?`,
    [opts.adminId, opts.note ?? null, opts.userId],
  );
  return getEntitlementRow(opts.userId);
}
