import { NextRequest, NextResponse } from "next/server";
import { requireAgentAuth, resolveAgentUserId } from "@/lib/agentAuth";
import { handleError } from "@/lib/api";
import { listIntents } from "@/lib/store";

export async function GET(req: NextRequest) {
  try {
    requireAgentAuth(req);
    const userId = await resolveAgentUserId();
    const pending = await listIntents(userId, "pending", 20);
    return NextResponse.json({ pending, count: pending.length });
  } catch (e) {
    return handleError(e);
  }
}
