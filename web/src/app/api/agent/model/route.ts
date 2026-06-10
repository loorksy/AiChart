import { NextRequest, NextResponse } from "next/server";
import { requireAgentAuth } from "@/lib/agentAuth";
import { handleError } from "@/lib/api";
import { getAnthropicModel } from "@/lib/anthropic";
import { refreshPlatformConfigCache } from "@/lib/platformConfig";

/**
 * Bridge: the Claude model chosen in the admin panel — lets the OpenClaw
 * gateway follow the same selection (see agent/scripts/sync-model.sh).
 */
export async function GET(req: NextRequest) {
  try {
    requireAgentAuth(req);
    await refreshPlatformConfigCache();
    const model = getAnthropicModel();
    return NextResponse.json({ model, ref: `anthropic/${model}` });
  } catch (e) {
    return handleError(e);
  }
}
