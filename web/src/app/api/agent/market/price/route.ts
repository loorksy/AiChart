import { NextRequest, NextResponse } from "next/server";
import { resolveBridgeUserId } from "@/lib/agentAuth";
import { handleError } from "@/lib/api";
import { getSettings } from "@/lib/store";
import { getUnifiedPrice } from "@/lib/markets";
import type { MarketType } from "@/lib/markets/types";

/** Bridge: spot price for a symbol (crypto via Binance, forex via EA/MetaApi). */
export async function GET(req: NextRequest) {
  try {
    const userId = await resolveBridgeUserId(req);
    const { searchParams } = new URL(req.url);
    const symbol = searchParams.get("symbol");
    if (!symbol) {
      return NextResponse.json({ error: "symbol مطلوب." }, { status: 400 });
    }
    const settings = await getSettings(userId);
    const market = (searchParams.get("market") ??
      settings.active_market ??
      "crypto") as MarketType;

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
