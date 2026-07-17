import { NextResponse } from "next/server";
import { requirePaidAccess, handleError } from "@/lib/api";
import { getEaConnectionMeta } from "@/lib/eaStore";

/** Live EA connection status (used by the market UI live badge). */
export async function GET() {
  try {
    const user = await requirePaidAccess();
    const meta = await getEaConnectionMeta(user.id);
    return NextResponse.json({
      connected: Boolean(meta && meta.status !== "revoked"),
      online: Boolean(meta?.online),
      connection: meta,
    });
  } catch (err) {
    return handleError(err);
  }
}
