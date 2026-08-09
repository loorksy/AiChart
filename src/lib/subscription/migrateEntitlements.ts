import { execute, query } from "@/lib/db";

/**
 * Existing-user migration policy (deterministic, no private data in reports):
 *
 * 1. Administrators → no entitlement gate (role bypass); ensure row optional.
 * 2. Users with access_expires_at in the future → plan_status=active, that expiry.
 * 3. Users with access_expires_at in the past → plan_status=expired.
 * 4. Users with null access_expires_at → plan_status=trial, used=0.
 *
 * Does not infer payment from feature use, account age, or chat history.
 * Does not reset trial counters on subsequent runs (INSERT … DO NOTHING / skip existing rows).
 */

export type EntitlementMigrationDryRun = {
  totalUsers: number;
  admins: number;
  activeFromExpiry: number;
  expiredFromExpiry: number;
  trialDefault: number;
  alreadyProvisioned: number;
};

export async function dryRunEntitlementMigration(): Promise<EntitlementMigrationDryRun> {
  const users = await query<{
    id: number;
    role: string;
    access_expires_at: string | null;
  }>("SELECT id, role, access_expires_at FROM users");

  const existing = await query<{ user_id: number }>(
    "SELECT user_id FROM user_entitlements",
  ).catch(() => [] as { user_id: number }[]);
  const have = new Set(existing.map((r) => r.user_id));

  let admins = 0;
  let activeFromExpiry = 0;
  let expiredFromExpiry = 0;
  let trialDefault = 0;
  let alreadyProvisioned = 0;
  const now = Date.now();

  for (const u of users) {
    if (have.has(u.id)) {
      alreadyProvisioned += 1;
      continue;
    }
    if (u.role === "admin") {
      admins += 1;
      continue;
    }
    if (u.access_expires_at) {
      const t = new Date(u.access_expires_at).getTime();
      if (Number.isFinite(t) && t > now) activeFromExpiry += 1;
      else expiredFromExpiry += 1;
    } else {
      trialDefault += 1;
    }
  }

  return {
    totalUsers: users.length,
    admins,
    activeFromExpiry,
    expiredFromExpiry,
    trialDefault,
    alreadyProvisioned,
  };
}

export async function applyEntitlementMigration(): Promise<EntitlementMigrationDryRun> {
  const report = await dryRunEntitlementMigration();
  const users = await query<{
    id: number;
    role: string;
    access_expires_at: string | null;
  }>("SELECT id, role, access_expires_at FROM users");
  const now = Date.now();

  for (const u of users) {
    if (u.role === "admin") {
      await execute(
        `INSERT INTO user_entitlements (user_id, plan_status, trial_interactions_used, trial_in_flight)
         VALUES (?, 'active', 0, 0)
         ON CONFLICT (user_id) DO NOTHING`,
        [u.id],
      );
      continue;
    }

    let status: "trial" | "active" | "expired" = "trial";
    let expires: string | null = null;
    if (u.access_expires_at) {
      expires = u.access_expires_at;
      const t = new Date(u.access_expires_at).getTime();
      status = Number.isFinite(t) && t > now ? "active" : "expired";
    }

    await execute(
      `INSERT INTO user_entitlements
         (user_id, plan_status, trial_interactions_used, trial_in_flight, subscription_expires_at)
       VALUES (?, ?, 0, 0, ?)
       ON CONFLICT (user_id) DO NOTHING`,
      [u.id, status, expires],
    );
  }

  return report;
}
