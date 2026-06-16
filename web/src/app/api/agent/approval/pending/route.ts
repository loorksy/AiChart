import { NextRequest, NextResponse } from "next/server";
import { resolveBridgeUserId } from "@/lib/agentAuth";
import { handleError } from "@/lib/api";
import { listIntents } from "@/lib/store";

export async function GET(req: NextRequest) {
  try {
    const userId = await resolveBridgeUserId(req);
    const pending = await listIntents(userId, "pending", 20);
    return NextResponse.json({ pending, count: pending.length });
  } catch (e) {
    return handleError(e);
  }
}
