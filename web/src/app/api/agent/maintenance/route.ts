import { NextRequest, NextResponse } from "next/server";
import { resolveBridgeUserId } from "@/lib/agentAuth";
import { handleError } from "@/lib/api";
import { runUserPostScan } from "@/lib/cronPostScan";

/**
 * Bridge: mechanical trade maintenance — OCO fill sync + auto take-profit
 * for the authenticated MCP user only.
 */
export async function POST(req: NextRequest) {
  try {
    const userId = await resolveBridgeUserId(req);
    const result = await runUserPostScan(userId);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return handleError(e);
  }
}
