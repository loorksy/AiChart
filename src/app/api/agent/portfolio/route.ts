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



/** Bridge: full portfolio view — balances, open/recent trades, pending intents. */

export async function GET(req: NextRequest) {

  try {

    const userId = await resolveBridgeUserId(req);



    const [openTrades, recentTrades, pendingIntents, recommendations, mt] =

      await Promise.all([

        listOpenTrades(userId, 30),

        listTrades(userId, 15),

        listIntents(userId, "pending", 10),

        listRecommendations(userId, 10),

        getMtAccountMeta(userId),

      ]);



    return NextResponse.json({

      forex: { metaapi: mt },

      connection: mt,

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


