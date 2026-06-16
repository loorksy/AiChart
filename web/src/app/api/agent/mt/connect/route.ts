import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveBridgeUserId } from "@/lib/agentAuth";
import { handleError } from "@/lib/api";
import { logAudit } from "@/lib/store";
import {
  connectMtAccount,
  disconnectMtAccount,
  formatMtConnectError,
  mtConnectSchema,
} from "@/lib/mtConnectFlow";

/** Bridge: connect MetaTrader via MetaApi or mt5local (server + login + password). */
export async function POST(req: NextRequest) {
  try {
    const userId = await resolveBridgeUserId(req);
    const body = mtConnectSchema.parse(await req.json());
    const result = await connectMtAccount(userId, body);
    await logAudit(userId, "agent_mt_connect", `${body.platform}:${body.login}`);
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

/** Bridge: disconnect MetaTrader account. */
export async function DELETE(req: NextRequest) {
  try {
    const userId = await resolveBridgeUserId(req);
    const result = await disconnectMtAccount(userId);
    await logAudit(userId, "agent_mt_disconnect", "ok");
    return NextResponse.json(result);
  } catch (err) {
    return handleError(err);
  }
}
