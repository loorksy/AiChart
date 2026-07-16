import { NextRequest, NextResponse } from "next/server";
import { resolveBridgeUserId } from "@/lib/agentAuth";
import { handleError } from "@/lib/api";
import { DEFAULT_MARKET, rejectNonForexMarket, resolveActiveMarket } from "@/lib/marketPolicy";
import { getUnifiedPrice } from "@/lib/markets";

/** Bridge: spot price for a forex symbol via EA/MetaApi or OANDA. */
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
    return NextResponse.json({
      symbol: resolved.symbol,
      market: resolved.market,
      price,
    });
  } catch (e) {
    return handleError(e);
  }
}
