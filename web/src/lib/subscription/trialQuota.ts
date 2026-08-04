import { execute, queryOne } from "@/lib/db";
import type { PublicUser } from "@/lib/types";
import { AICHART_PLAN } from "@/lib/subscription/plan";
import {
  ensureEntitlementRow,
  getEntitlementForUser,
} from "@/lib/subscription/entitlement";

function nowExpr(): string {
  return process.env.DATABASE_URL ? "NOW()" : "datetime('now')";
}

export type TrialClaimResult =
  | { ok: true; mode: "paid" | "admin" }
  | { ok: true; mode: "trial"; used: number; remaining: number }
  | { ok: false; reason: "exhausted" | "blocked"; used: number; remaining: number };

/**
 * Atomically reserve one trial slot before calling the model provider.
 * Paid / admin users skip reservation. Concurrent requests cannot exceed the limit.
 */
export async function claimTrialInteraction(
  user: Pick<PublicUser, "id" | "role" | "status">,
  requestId: string,
): Promise<TrialClaimResult> {
  const snap = await getEntitlementForUser(user);
  if (snap.isAdmin || snap.hasPaidAccess) {
    return { ok: true, mode: snap.isAdmin ? "admin" : "paid" };
  }
  if (snap.access === "blocked" && snap.planStatus !== "trial") {
    return {
      ok: false,
      reason: "blocked",
      used: snap.trialUsed,
      remaining: 0,
    };
  }

  await ensureEntitlementRow(user.id);

  // Idempotent re-claim of the same request id (retries).
  const existing = await queryOne<{ status: string }>(
    `SELECT status FROM trial_interaction_ledger WHERE request_id = ?`,
    [requestId],
  );
  if (existing?.status === "committed" || existing?.status === "pending") {
    const row = await ensureEntitlementRow(user.id);
    const used = row.trial_interactions_used;
    return {
      ok: true,
      mode: "trial",
      used,
      remaining: Math.max(0, AICHART_PLAN.trialInteractions - used),
    };
  }

  const claimed = await execute(
    `UPDATE user_entitlements
        SET trial_in_flight = trial_in_flight + 1,
            updated_at = ${nowExpr()}
      WHERE user_id = ?
        AND plan_status = 'trial'
        AND (trial_interactions_used + trial_in_flight) < ?`,
    [user.id, AICHART_PLAN.trialInteractions],
  );

  if (claimed.changes < 1) {
    const row = await ensureEntitlementRow(user.id);
    return {
      ok: false,
      reason: "exhausted",
      used: row.trial_interactions_used,
      remaining: 0,
    };
  }

  await execute(
    `INSERT INTO trial_interaction_ledger (user_id, request_id, status)
     VALUES (?, ?, 'pending')
     ON CONFLICT (request_id) DO NOTHING`,
    [user.id, requestId],
  );

  const row = await ensureEntitlementRow(user.id);
  const used = row.trial_interactions_used;
  return {
    ok: true,
    mode: "trial",
    used,
    remaining: Math.max(0, AICHART_PLAN.trialInteractions - used - 1),
  };
}

/** Commit a reserved trial interaction after a completed agent response. */
export async function commitTrialInteraction(
  userId: number,
  requestId: string,
): Promise<void> {
  const ledger = await queryOne<{ status: string }>(
    `SELECT status FROM trial_interaction_ledger WHERE request_id = ? AND user_id = ?`,
    [requestId, userId],
  );
  if (!ledger || ledger.status === "committed") return;
  if (ledger.status === "released") return;

  await execute(
    `UPDATE trial_interaction_ledger
        SET status = 'committed', committed_at = ${nowExpr()}
      WHERE request_id = ? AND user_id = ? AND status = 'pending'`,
    [requestId, userId],
  );
  await execute(
    `UPDATE user_entitlements
        SET trial_interactions_used = trial_interactions_used + 1,
            trial_in_flight = CASE WHEN trial_in_flight > 0 THEN trial_in_flight - 1 ELSE 0 END,
            updated_at = ${nowExpr()}
      WHERE user_id = ? AND plan_status = 'trial'`,
    [userId],
  );
}

/** Release a reservation when the provider call fails or is cancelled. */
export async function releaseTrialInteraction(
  userId: number,
  requestId: string,
): Promise<void> {
  const ledger = await queryOne<{ status: string }>(
    `SELECT status FROM trial_interaction_ledger WHERE request_id = ? AND user_id = ?`,
    [requestId, userId],
  );
  if (!ledger || ledger.status !== "pending") return;

  await execute(
    `UPDATE trial_interaction_ledger
        SET status = 'released'
      WHERE request_id = ? AND user_id = ? AND status = 'pending'`,
    [requestId, userId],
  );
  await execute(
    `UPDATE user_entitlements
        SET trial_in_flight = CASE WHEN trial_in_flight > 0 THEN trial_in_flight - 1 ELSE 0 END,
            updated_at = ${nowExpr()}
      WHERE user_id = ?`,
    [userId],
  );
}

export function subscriptionRequiredMessage(locale: "ar" | "en" = "ar"): string {
  if (locale === "en") {
    return (
      `You have used your ${AICHART_PLAN.trialInteractions} free trial interactions. ` +
      `Full Lonora access is available for $${AICHART_PLAN.promotionalPriceUsd} ` +
      `(regular price $${AICHART_PLAN.regularPriceUsd}). ` +
      `Contact @${AICHART_PLAN.telegramHandle} on Telegram to activate.`
    );
  }
  return (
    `استهلكت ${AICHART_PLAN.trialInteractions} تفاعلات تجريبية. ` +
    `الوصول الكامل متاح بسعر ${AICHART_PLAN.promotionalPriceUsd}$ ` +
    `(السعر المعتاد ${AICHART_PLAN.regularPriceUsd}$). ` +
    `تواصل عبر تيليجرام @${AICHART_PLAN.telegramHandle} لتفعيل الاشتراك.`
  );
}
