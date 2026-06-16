import { NextRequest, NextResponse } from "next/server";
import { resolveBridgeUserId } from "@/lib/agentAuth";
import { handleError } from "@/lib/api";
import { getExecutionEnvSnapshot } from "@/lib/executionEnv";
import {
  buildOpenTradesSummary,
  loadBrokerMt5Positions,
} from "@/lib/openTradesSummary";
import { listOpenTrades } from "@/lib/store";

export async function GET(req: NextRequest) {
  try {
    const userId = await resolveBridgeUserId(req);
    const [executionEnv, aichartTrades, brokerMt5] = await Promise.all([
      getExecutionEnvSnapshot(userId),
      listOpenTrades(userId, 30),
      loadBrokerMt5Positions(userId),
    ]);
    const summary_ar = await buildOpenTradesSummary(
      userId,
      aichartTrades,
      brokerMt5,
    );
    return NextResponse.json({
      executionEnv,
      aichartTrades,
      brokerPositions: { mt5: brokerMt5, binance: null },
      summary_ar,
    });
  } catch (e) {
    return handleError(e);
  }
}
