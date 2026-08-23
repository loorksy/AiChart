import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { initDb } from "@/lib/db";
import { getCreditBalance, listCreditEntries } from "@/lib/billing/credits";
import { billingEnforced } from "@/lib/billing/spend";
import { getEntitlementForUser } from "@/lib/subscription/entitlement";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Billing v3: the signed-in user's own CREDIT balance, account state, and
 * recent movement — the ledger the user is entitled to see. Feeds the
 * billing page and the account-status panel.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });
  await initDb();
  const [balance, entitlement, enforced, entries] = await Promise.all([
    getCreditBalance(user.id),
    getEntitlementForUser(user),
    billingEnforced(),
    listCreditEntries(user.id, 50),
  ]);
  return NextResponse.json({
    ok: true,
    billing_enforced: enforced,
    balance,
    plan_status: entitlement.planStatus,
    has_paid_access: entitlement.hasPaidAccess,
    expires_at: entitlement.expiresAt,
    ledger: entries.map((e) => ({
      ts: e.ts,
      kind: e.kind,
      amount: e.amount,
      balance_after: e.balance_after,
      note: e.note,
    })),
  });
}
