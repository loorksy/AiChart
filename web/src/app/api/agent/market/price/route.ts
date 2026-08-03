import { NextRequest, NextResponse } from "next/server";
import { resolveBridgeUserId } from "@/lib/agentAuth";
import { handleError } from "@/lib/api";
import { DEFAULT_MARKET, rejectNonForexMarket, resolveActiveMarket } from "@/lib/marketPolicy";
import { getUnifiedPrice } from "@/lib/markets";
import { getSessionStatus } from "@/lib/markets/tradingCalendar";

/** Bridge: spot price for a forex symbol via the linked broker or OANDA. */
export async function GET(req: NextRequest) {
  try {
    const userId = await resolveBridgeUserId(req);
    const { searchParams } = new URL(req.url);
    const symbol = searchParams.get("symbol");
    if (!symbol) {
      return NextResponse.json({ error: "symbol مطلوب." }, { status: 400 });
    }
    const rawMarket = searchParams.get("market") ?? DEFAULT_MARKET;
    const marketErr = rejectNonForexMarket(rawMarket);
    if (marketErr) {
      return NextResponse.json({ error: marketErr }, { status: 400 });
    }
    const market = resolveActiveMarket(rawMarket ?? DEFAULT_MARKET);

    const { resolved, price } = await getUnifiedPrice(symbol, market, userId);
    // The session of the SYMBOL ASKED FOR, not of the chart the operator
    // happens to be on: gold can be in its maintenance hour while EURUSD
    // trades, and an agent quoting a frozen tape as if it were live is the
    // failure this field exists to prevent.
    const session = getSessionStatus(resolved.symbol);
    return NextResponse.json({
      symbol: resolved.symbol,
      market: resolved.market,
      price,
      market_open: session.isOpen,
      session_reason: session.reason,
      ...(session.isOpen
        ? {}
        : {
            analysis_blocked: true,
            note_ar: "سوق هذا الزوج مغلق — لا يمكن تحليله الآن.",
            note_en: "This pair's market is closed — it cannot be analysed now.",
          }),
    });
  } catch (e) {
    return handleError(e);
  }
}
