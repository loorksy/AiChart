import { NextResponse } from "next/server";
import { handleError } from "@/lib/api";
import { requireAdminWith } from "@/lib/adminRoles";
import { refreshPlatformConfigCache } from "@/lib/platformConfig";
import { getAgentModelStatus } from "@/lib/agentModelConfig";

export async function GET() {
  try {
    await requireAdminWith("keys_write");
    await refreshPlatformConfigCache();
    return NextResponse.json(getAgentModelStatus());
  } catch (err) {
    return handleError(err);
  }
}
