import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, handleError } from "@/lib/api";
import { initDb } from "@/lib/db";
import { adjustAdmin, getBalance } from "@/lib/billing/creditLedger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** V2-A2 (#91): manual credit adjustment. Reason is MANDATORY — it lands in the ledger. */
const schema = z.object({
  user_id: z.number().int().positive(),
  amount_usd: z.number().min(-1000).max(1000).refine((v) => v !== 0, "amount must be non-zero"),
  reason: z.string().min(5).max(400),
});

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin();
    await initDb();
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: parsed.error.issues[0]?.message ?? "invalid payload" },
        { status: 400 },
      );
    }
    const { user_id, amount_usd, reason } = parsed.data;
    await adjustAdmin(user_id, amount_usd, reason, admin.id);
    return NextResponse.json({ ok: true, balance: await getBalance(user_id) });
  } catch (err) {
    return handleError(err);
  }
}
