import { NextRequest, NextResponse } from "next/server";
import { requireAgentAuth, resolveAgentUserId } from "@/lib/agentAuth";
import { handleError } from "@/lib/api";
import { getMtConnectionStatus } from "@/lib/mtConnectFlow";

/** Bridge: MetaTrader connection status (MetaApi or mt5local). */
export async function GET(_req: NextRequest) {
  try {
    requireAgentAuth(_req);
    const userId = await resolveAgentUserId();
    return NextResponse.json(await getMtConnectionStatus(userId));
  } catch (err) {
    return handleError(err);
  }
}
