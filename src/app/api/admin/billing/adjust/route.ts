import { NextResponse } from "next/server";
import { z } from "zod";
import { handleError } from "@/lib/api";
import { auditAdminAction, requireAdminWith } from "@/lib/adminRoles";
import { initDb } from "@/lib/db";
import { debitCredits, getCreditBalance, grantCredits } from "@/lib/billing/credits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Billing v3 manual credit adjustment (integer CREDITS). Reason is
 * MANDATORY — it lands in the ledger. A negative adjustment goes through
 * the same conditional debit as every spend: it can empty a balance, it
 * can never take it below zero.
 */
const schema = z.object({
  user_id: z.number().int().positive(),
  credits: z
    .number()
    .int()
    .min(-100000)
    .max(100000)
    .refine((v) => v !== 0, "amount must be non-zero"),
  reason: z.string().min(5).max(400),
});

export async function POST(req: Request) {
  try {
    const { admin } = await requireAdminWith("billing_write");
    await initDb();
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: parsed.error.issues[0]?.message ?? "invalid payload" },
        { status: 400 },
      );
    }
    const { user_id, credits, reason } = parsed.data;
    const ref = `admin:${admin.id}:${Date.now()}`;
    if (credits > 0) {
      await grantCredits({
        userId: user_id,
        amount: credits,
        kind: "admin_adjust",
        ref,
        note: reason,
      });
    } else {
      const res = await debitCredits({
        userId: user_id,
        amount: -credits,
        kind: "admin_adjust",
        ref,
        note: reason,
      });
      if (!res.ok) {
        return NextResponse.json(
          { ok: false, error: "insufficient_balance — the balance never goes below zero" },
          { status: 409 },
        );
      }
    }
    await auditAdminAction(
      admin.id,
      "credit_adjust",
      String(user_id),
      `${credits} — ${reason}`,
    );
    return NextResponse.json({ ok: true, balance: await getCreditBalance(user_id) });
  } catch (err) {
    return handleError(err);
  }
}
