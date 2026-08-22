import { NextResponse } from "next/server";
import { z } from "zod";
import { handleError } from "@/lib/api";
import { auditAdminAction, requireAdminWith } from "@/lib/adminRoles";
import { execute, initDb, queryOne } from "@/lib/db";
import { grantCredits } from "@/lib/billing/credits";
import { getCurrentPlanPrice } from "@/lib/billing/planConfig";
import { activateSubscription } from "@/lib/subscription/entitlement";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Billing v3 manual activation — the pre-Stripe path. Grants ride the SAME
 * machinery the webhook uses: cycle_grant entries that ADD to the remaining
 * balance (rollover is structural), the entitlement date extended by the
 * CURRENT plan price's cycle, and the subscriber pinned to that price row.
 */
const postSchema = z.object({
  user_id: z.number().int().positive(),
  months: z.number().int().min(1).max(12).default(1),
  gift: z.boolean().default(false),
});

export async function POST(req: Request) {
  try {
    const { admin } = await requireAdminWith("billing_write");
    await initDb();
    const parsed = postSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: parsed.error.issues[0]?.message ?? "invalid payload" },
        { status: 400 },
      );
    }
    const { user_id, months, gift } = parsed.data;
    const price = await getCurrentPlanPrice();
    if (!price) {
      return NextResponse.json(
        { ok: false, error: "plan_price_unset — set the plan price in the billing tab first" },
        { status: 409 },
      );
    }
    const now = Date.now();
    const periodEnd = now + months * price.cycle_days * DAY_MS;

    // The entitlement row is THE access truth every gate reads.
    await activateSubscription({
      userId: user_id,
      adminId: admin.id,
      expiresAt: new Date(periodEnd).toISOString(),
      note: gift ? "gift" : "manual activation",
    });

    // Mirror for the panel + the pinned price row for future renewals.
    const updated = await execute(
      `UPDATE subscriptions SET tier = 'full', status = 'active', current_period_start = ?,
         current_period_end = ?, price_id = ?, updated_at = ? WHERE user_id = ?`,
      [now, periodEnd, price.id, now, user_id],
    );
    if (!updated.changes) {
      await execute(
        `INSERT INTO subscriptions (user_id, tier, status, started_at, current_period_start, current_period_end, price_id, updated_at)
         VALUES (?, 'full', 'active', ?, ?, ?, ?, ?)`,
        [user_id, now, now, periodEnd, price.id, now],
      );
    }

    if (price.credits_per_cycle > 0) {
      await grantCredits({
        userId: user_id,
        amount: months * price.credits_per_cycle,
        kind: "cycle_grant",
        ref: `admin:${admin.id}:${now}`,
        note: gift ? `gift x${months} by admin:${admin.id}` : `manual x${months} by admin:${admin.id}`,
      });
    }

    await auditAdminAction(
      admin.id,
      gift ? "gift_subscription" : "manual_subscription",
      String(user_id),
      `full x${months} @price_row:${price.id}`,
    );
    const sub = await queryOne("SELECT * FROM subscriptions WHERE user_id = ?", [user_id]);
    return NextResponse.json({ ok: true, subscription: sub });
  } catch (err) {
    return handleError(err);
  }
}
