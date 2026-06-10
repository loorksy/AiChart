import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, handleError } from "@/lib/api";
import { generateEaToken } from "@/lib/eaAuth";
import {
  deleteEaConnection,
  getEaConnectionMeta,
  upsertEaConnection,
} from "@/lib/eaStore";
import { logAudit } from "@/lib/store";

const schema = z.object({
  platform: z.enum(["mt4", "mt5"]).default("mt5"),
  label: z.string().max(60).optional(),
});

/** Generates (or rotates) the user's EA bridge token. Shown only once. */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const { platform, label } = schema.parse(await req.json().catch(() => ({})));
    const { token, tokenHash } = generateEaToken();
    await upsertEaConnection(user.id, platform, tokenHash, label ?? null);
    await logAudit(user.id, "ea_token_generated", platform);
    return NextResponse.json({ ok: true, token, platform });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: err.issues[0]?.message ?? "بيانات غير صالحة." },
        { status: 400 },
      );
    }
    return handleError(err);
  }
}

/** Returns the non-secret EA connection status for the UI. */
export async function GET() {
  try {
    const user = await requireUser();
    const meta = await getEaConnectionMeta(user.id);
    return NextResponse.json({ connection: meta });
  } catch (err) {
    return handleError(err);
  }
}

/** Revokes / removes the EA connection. */
export async function DELETE() {
  try {
    const user = await requireUser();
    await deleteEaConnection(user.id);
    await logAudit(user.id, "ea_token_revoked", null);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}
