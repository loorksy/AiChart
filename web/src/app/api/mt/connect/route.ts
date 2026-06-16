import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePlatformAccess, handleError } from "@/lib/api";
import {
  connectMtAccount,
  disconnectMtAccount,
  formatMtConnectError,
  mtConnectSchema,
} from "@/lib/mtConnectFlow";

/**
 * Connect user's MT account (login + password + server) — via MetaApi cloud
 * or the self-hosted MT5 bridge container, per the configured backend.
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requirePlatformAccess();
    const body = mtConnectSchema.parse(await req.json());
    const result = await connectMtAccount(user.id, body);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: err.issues[0]?.message ?? "بيانات غير صالحة." },
        { status: 400 },
      );
    }
    const message = formatMtConnectError(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

/** Disconnect MetaTrader account from MetaApi. */
export async function DELETE() {
  try {
    const user = await requirePlatformAccess();
    return NextResponse.json(await disconnectMtAccount(user.id));
  } catch (err) {
    return handleError(err);
  }
}
