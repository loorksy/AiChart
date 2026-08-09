import { NextRequest, NextResponse } from "next/server";
import { resolveBridgeUserId } from "@/lib/agentAuth";
import { handleError } from "@/lib/api";
import { getExecutionEnvSnapshot } from "@/lib/executionEnv";
import { buildOpenTradesSummary } from "@/lib/openTradesSummary";
import { listOpenTrades } from "@/lib/store";

export async function GET(req: NextRequest) {
  try {
    const userId = await resolveBridgeUserId(req);
    const [executionEnv, aichartTrades] = await Promise.all([
      getExecutionEnvSnapshot(userId),
      listOpenTrades(userId, 30),
    ]);
    const summary_ar = await buildOpenTradesSummary(userId, aichartTrades);
    return NextResponse.json({
      executionEnv,
      aichartTrades,
      summary_ar,
    });
  } catch (e) {
    return handleError(e);
  }
}
