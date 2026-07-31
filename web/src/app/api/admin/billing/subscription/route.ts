import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, handleError } from "@/lib/api";
import { execute, initDb, queryOne } from "@/lib/db";
import { grantMonthly } from "@/lib/billing/creditLedger";
import { TIERS, tierDef } from "@/lib/billing/tiers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * V2-A2 (#91): manual subscription control — the pre-Stripe activation path
 * (replaces the old Telegram manual flow) and the Stripe-webhook fallback.
 * Activating a tier grants the tier's included monthly credits immediately.
 * kind='gift' months are how existing accounts get their launch month.
 */
const postSchema = z.object({
  user_id: z.number().int().positive(),
  tier: z.enum(["lite", "plus", "pro", "promax"]),
  months: z.number().int().min(1).max(12).default(1),
  gift: z.boolean().default(false),
});

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin();
    await initDb();
    const parsed = postSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: parsed.error.issues[0]?.message ?? "invalid payload" },
        { status: 400 },
      );
    }
    const { user_id, tier, months, gift } = parsed.data;
    const def = tierDef(tier)!;
    const now = Date.now();
    const periodEnd = now + months * 30 * DAY_MS;

    const updated = await execute(
      `UPDATE subscriptions SET tier = ?, status = 'active', current_period_start = ?,
         current_period_end = ?, updated_at = ? WHERE user_id = ?`,
      [tier, now, periodEnd, now, user_id],
    );
    if (!updated.changes) {
      await execute(
        `INSERT INTO subscriptions (user_id, tier, status, started_at, current_period_start, current_period_end, updated_at)
         VALUES (?, ?, 'active', ?, ?, ?, ?)`,
        [user_id, tier, now, now, periodEnd, now],
      );
    }
    await grantMonthly(
      user_id,
      def.includedCreditsUsd,
      periodEnd,
      gift ? "gift" : "monthly_grant",
      gift ? `launch gift by admin:${admin.id}` : `manual activation by admin:${admin.id}`,
    );
    const sub = await queryOne("SELECT * FROM subscriptions WHERE user_id = ?", [user_id]);
    return NextResponse.json({ ok: true, subscription: sub, tiers: Object.keys(TIERS) });
  } catch (err) {
    return handleError(err);
  }
}
