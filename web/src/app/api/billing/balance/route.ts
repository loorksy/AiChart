import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { initDb, query } from "@/lib/db";
import { getBalance } from "@/lib/billing/creditLedger";
import { billingEnforced, getSubscription } from "@/lib/billing/gate";
import { tierDef } from "@/lib/billing/tiers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * V2-A2 (#91): the signed-in user's own balance + tier + recent statement.
 * Feeds the composer credit meter and the billing page (A5).
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });
  await initDb();
  const [balance, sub, enforced, recent] = await Promise.all([
    getBalance(user.id),
    getSubscription(user.id),
    billingEnforced(),
    query(
      `SELECT ts, kind, amount_usd, bucket, note FROM credit_ledger
       WHERE user_id = ? ORDER BY ts DESC LIMIT 50`,
      [user.id],
    ),
  ]);
  const tier = sub ? tierDef(sub.tier) : null;
  return NextResponse.json({
    ok: true,
    billing_enforced: enforced,
    balance,
    subscription: sub
      ? {
          tier: sub.tier,
          tier_name_ar: tier?.nameAr ?? sub.tier,
          status: sub.status,
          period_end: sub.current_period_end,
        }
      : null,
    ledger: recent,
  });
}
