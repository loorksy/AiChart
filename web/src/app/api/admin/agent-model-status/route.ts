import { NextResponse } from "next/server";
import { requireAdmin, handleError } from "@/lib/api";
import { refreshPlatformConfigCache } from "@/lib/platformConfig";
import { getAgentModelStatus } from "@/lib/agentModelConfig";

export async function GET() {
  try {
    await requireAdmin();
    await refreshPlatformConfigCache();
    return NextResponse.json(getAgentModelStatus());
  } catch (err) {
    return handleError(err);
  }
}
