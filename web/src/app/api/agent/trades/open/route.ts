import { NextRequest, NextResponse } from "next/server";
import { resolveBridgeUserId } from "@/lib/agentAuth";
import { handleError } from "@/lib/api";
import { getExecutionEnvSnapshot } from "@/lib/executionEnv";
import {
  attachLiveEaPnl,
  buildOpenTradesSummary,
  loadBrokerMt5Positions,
} from "@/lib/openTradesSummary";
import { listOpenTrades } from "@/lib/store";

export async function GET(req: NextRequest) {
  try {
    const userId = await resolveBridgeUserId(req);
    const [executionEnv, dbTrades, brokerMt5] = await Promise.all([
      getExecutionEnvSnapshot(userId),
      listOpenTrades(userId, 30),
      loadBrokerMt5Positions(userId),
    ]);
    const aichartTrades = attachLiveEaPnl(dbTrades, brokerMt5);
    const summary_ar = await buildOpenTradesSummary(
      userId,
      aichartTrades,
      brokerMt5,
    );
    return NextResponse.json({
      executionEnv,
      aichartTrades,
      brokerPositions: { mt5: brokerMt5 },
      summary_ar,
    });
  } catch (e) {
    return handleError(e);
  }
}
