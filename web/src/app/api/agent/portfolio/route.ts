import { NextRequest, NextResponse } from "next/server";
import { resolveBridgeUserId } from "@/lib/agentAuth";
import { handleError } from "@/lib/api";
import {
  getBinanceCredentials,
  getMtAccountMeta,
  listIntents,
  listOpenTrades,
  listRecommendations,
  listTrades,
  todayRealizedPnlUsd,
} from "@/lib/store";
import { getEaConnectionMeta } from "@/lib/eaStore";
import {
  attachLiveEaPnl,
  loadBrokerMt5Positions,
} from "@/lib/openTradesSummary";
import { getAccountSummary } from "@/lib/binance";

/** Bridge: full portfolio view — balances, open/recent trades, pending intents. */
export async function GET(req: NextRequest) {
  try {
    const userId = await resolveBridgeUserId(req);

    let binance: unknown = null;
    const creds = await getBinanceCredentials(userId);
    if (creds) {
      try {
        const summary = await getAccountSummary(
          creds.apiKey,
          creds.apiSecret,
          creds.env,
          creds.region,
        );
        binance = {
          env: creds.env,
          region: creds.region,
          canTrade: summary.canTrade,
          balances: summary.balances.slice(0, 20),
        };
      } catch (e) {
        binance = {
          env: creds.env,
          error: e instanceof Error ? e.message : "تعذّر جلب الأرصدة.",
        };
      }
    }

    const [dbOpenTrades, recentTrades, pendingIntents, recommendations, mt, ea, mt5Positions] =
      await Promise.all([
        listOpenTrades(userId, 30),
        listTrades(userId, 15),
        listIntents(userId, "pending", 10),
        listRecommendations(userId, 10),
        getMtAccountMeta(userId),
        getEaConnectionMeta(userId),
        loadBrokerMt5Positions(userId),
      ]);
    const openTrades = attachLiveEaPnl(dbOpenTrades, mt5Positions);

    return NextResponse.json({
      binance,
      forex: { metaapi: mt, ea },
      openTrades,
      recentTrades,
      pendingIntents,
      recommendations,
      todayRealizedPnlUsd: await todayRealizedPnlUsd(userId),
    });
  } catch (e) {
    return handleError(e);
  }
}
