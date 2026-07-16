import { NextResponse } from "next/server";
import { requirePlatformAccess, handleError } from "@/lib/api";
import { countOpenTrades, getFlag, getLimits, todayRealizedPnlUsd } from "@/lib/store";
import { AGENT_LAST_SEEN_FLAG, isAgentBridgeConfigured } from "@/lib/agentAuth";

/** Technical health only. It deliberately exposes no decision-mode switch. */
export async function GET() {
  try {
    const user = await requirePlatformAccess();
    const limits = await getLimits(user.id);
    return NextResponse.json({
      bridgeConfigured: isAgentBridgeConfigured(),
      lastSeen: await getFlag(AGENT_LAST_SEEN_FLAG),
      executionAuthorized: limits.can_execute === 1,
      openTrades: await countOpenTrades(user.id),
      todayPnlUsd: await todayRealizedPnlUsd(user.id),
    });
  } catch (error) {
    return handleError(error);
  }
}
