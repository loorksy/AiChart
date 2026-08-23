import { NextResponse } from "next/server";
import { z } from "zod";
import { handleError } from "@/lib/api";
import { auditAdminAction, requireAdminWith } from "@/lib/adminRoles";
import { initDb } from "@/lib/db";
import { resetAllAccountsToFree } from "@/lib/billing/accountReset";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Put every non-admin account back to FREE with a fresh welcome balance.
 *
 * Destructive and deliberate: it clears balances and the whole credit
 * ledger, so the caller must send the confirmation phrase. It is an admin
 * ACTION rather than a deploy migration because the welcome grant is a
 * number the operator sets first — a migration would have handed out the
 * column default before they ever saw the field.
 */
const schema = z.object({ confirm: z.literal("RESET") });

export async function POST(req: Request) {
  try {
    const { admin } = await requireAdminWith("billing_write");
    await initDb();
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: 'send {"confirm":"RESET"} — this clears every balance' },
        { status: 400 },
      );
    }
    const result = await resetAllAccountsToFree();
    await auditAdminAction(
      admin.id,
      "accounts_reset",
      "all",
      `${result.accounts} accounts → free, ${result.granted} granted ${result.grantEach} credits each`,
    );
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return handleError(err);
  }
}
