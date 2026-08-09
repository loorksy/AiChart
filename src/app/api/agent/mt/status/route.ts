import { NextRequest, NextResponse } from "next/server";
import { resolveBridgeUserId } from "@/lib/agentAuth";
import { handleError } from "@/lib/api";
import { getMtConnectionStatus } from "@/lib/mtConnectFlow";

/** Bridge: MetaTrader connection status (MetaApi or mt5local). */
export async function GET(req: NextRequest) {
  try {
    const userId = await resolveBridgeUserId(req);
    return NextResponse.json(await getMtConnectionStatus(userId));
  } catch (err) {
    return handleError(err);
  }
}
