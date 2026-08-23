import { NextRequest, NextResponse } from "next/server";
import { handleError } from "@/lib/api";
import { requireAdminWith } from "@/lib/adminRoles";
import { initDb, query } from "@/lib/db";
import { ensureEntitlementRow } from "@/lib/subscription/entitlement";
import { getCreditBalance } from "@/lib/billing/credits";

export async function GET(req: NextRequest) {
  try {
    await requireAdminWith("billing_read");
    await initDb();
    const q = (req.nextUrl.searchParams.get("q") ?? "").trim().toLowerCase();
    if (!q || q.length < 2) {
      return NextResponse.json({ users: [] });
    }

    const users = await query<{
      id: number;
      email: string;
      role: string;
      status: string;
    }>(
      `SELECT id, email, role, status FROM users
        WHERE lower(email) LIKE ?
        ORDER BY id DESC
        LIMIT 25`,
      [`%${q}%`],
    );

    const enriched = [];
    for (const u of users) {
      const ent = await ensureEntitlementRow(u.id);
      enriched.push({
        user_id: u.id,
        email: u.email,
        role: u.role,
        status: u.status,
        plan_status: ent.plan_status,
        subscription_expires_at: ent.subscription_expires_at,
        note: ent.note,
        // The balance an admin is about to change: a manual top-up decided
        // without seeing the current number is a guess.
        credits: await getCreditBalance(u.id),
      });
    }

    return NextResponse.json({ users: enriched });
  } catch (e) {
    return handleError(e);
  }
}
