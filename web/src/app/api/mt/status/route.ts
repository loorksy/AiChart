import { NextResponse } from "next/server";
import { requirePlatformAccess, handleError } from "@/lib/api";
import { getMtConnectionStatus } from "@/lib/mtConnectFlow";

/** Live MetaTrader connection status (MetaApi cloud or self-hosted bridge). */
export async function GET() {
  try {
    const user = await requirePlatformAccess();
    return NextResponse.json(await getMtConnectionStatus(user.id));
  } catch (err) {
    return handleError(err);
  }
}
