import { NextRequest, NextResponse } from "next/server";
import { requireAgentAuth } from "@/lib/agentAuth";
import { handleError } from "@/lib/api";
import { runCronPostScan } from "@/lib/cronPostScan";

/**
 * Bridge: mechanical trade maintenance — OCO fill sync + auto take-profit.
 * The heartbeat calls this each open-trades review tick (replaces the cron).
 */
export async function POST(req: NextRequest) {
  try {
    requireAgentAuth(req);
    const result = await runCronPostScan();
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return handleError(e);
  }
}
