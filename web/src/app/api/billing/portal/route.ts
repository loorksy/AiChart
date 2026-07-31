import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { initDb, queryOne } from "@/lib/db";
import { createPortalSession, getStripeKeys } from "@/lib/billing/stripe";
import { getPlatformValueAsync } from "@/lib/platformConfig";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** V2-A3 (#92): Stripe customer portal — cancel/upgrade/invoices. */
export async function POST() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });
  await initDb();
  if (!(await getStripeKeys())) {
    return NextResponse.json(
      { ok: false, error: "stripe_not_configured" },
      { status: 503 },
    );
  }
  const row = await queryOne<{ stripe_customer_id: string | null }>(
    "SELECT stripe_customer_id FROM subscriptions WHERE user_id = ?",
    [user.id],
  );
  if (!row?.stripe_customer_id) {
    return NextResponse.json(
      { ok: false, error: "no_stripe_customer" },
      { status: 404 },
    );
  }
  const appUrl =
    (await getPlatformValueAsync("APP_URL")) ?? "https://aichart.lork.cloud";
  const url = await createPortalSession(row.stripe_customer_id, appUrl);
  return NextResponse.json({ ok: true, url });
}
