import { NextResponse } from "next/server";
import { initDb } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { listTopupPacks } from "@/lib/billing/planConfig";
import { paymentStatus } from "@/lib/billing/paymentProvider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The purchasable credit packs (active only) — the buy page reads this. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });
  await initDb();
  const [packs, payments] = await Promise.all([listTopupPacks(false), paymentStatus()]);
  return NextResponse.json({
    ok: true,
    payments_configured: payments.configured,
    packs: packs.map((p) => ({
      id: p.id,
      credits: p.credits,
      price_cents: p.price_cents,
    })),
  });
}
