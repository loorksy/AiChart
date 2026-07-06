import { NextRequest, NextResponse } from "next/server";

import { resolveBridgeUserId } from "@/lib/agentAuth";

import { handleError } from "@/lib/api";

import {

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



/** Bridge: full portfolio view — balances, open/recent trades, pending intents. */

export async function GET(req: NextRequest) {

  try {

    const userId = await resolveBridgeUserId(req);



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


