import { NextRequest, NextResponse } from "next/server";
import { resolveBridgeUserId } from "@/lib/agentAuth";
import { handleError } from "@/lib/api";
import { getMtAccountMeta, listOpenTrades } from "@/lib/store";

/**
 * Bridge: unified live account view. Quote/position freshness here was fed
 * exclusively by EA heartbeat pushes — metaapi/mt5local publish neither, so
 * those stay honest empties rather than reviving the EA-only heartbeat
 * plumbing (use get_market_price for live quotes). Balance/equity/broker
 * still come from the account link itself (mt_accounts), same as
 * get_portfolio.
 */
export async function GET(req: NextRequest) {
  try {
    const userId = await resolveBridgeUserId(req);
    const [connection, openTrades] = await Promise.all([
      getMtAccountMeta(userId),
      listOpenTrades(userId, 50),
    ]);

    return NextResponse.json({
      ok: true,
      at: new Date().toISOString(),
      connection,
      forex: {
        heartbeatFresh: false,
        liveQuoteCount: 0,
        quotes: {},
        positions: [],
        recentEvents: [],
      },
      openTrades,
      hints: {
        staleQuoteThresholdMs: 5000,
        rule: "استخدم get_market_price للسعر اللحظي وquoteAgeMs.",
      },
    });
  } catch (e) {
    return handleError(e);
  }
}
