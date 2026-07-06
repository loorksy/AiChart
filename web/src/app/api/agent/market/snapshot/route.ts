import { NextRequest, NextResponse } from "next/server";
import { resolveBridgeUserId } from "@/lib/agentAuth";
import { handleError } from "@/lib/api";
import { DEFAULT_MARKET, rejectNonForexMarket, resolveActiveMarket } from "@/lib/marketPolicy";
import { getSettings } from "@/lib/store";
import { getUnifiedSnapshot } from "@/lib/markets";

/** Bridge: live technical snapshot (price, RSI, MACD, SMA, trend). */
export async function GET(req: NextRequest) {
  try {
    const userId = await resolveBridgeUserId(req);
    const { searchParams } = new URL(req.url);
    const symbol = searchParams.get("symbol");
    if (!symbol) {
      return NextResponse.json({ error: "symbol مطلوب." }, { status: 400 });
    }
    const interval = searchParams.get("interval") ?? "1h";
    const settings = await getSettings(userId);
    const rawMarket = searchParams.get("market") ?? settings.active_market;
    const marketErr = rejectNonForexMarket(rawMarket);
    if (marketErr) {
      return NextResponse.json({ error: marketErr }, { status: 400 });
    }
    const market = resolveActiveMarket(rawMarket ?? DEFAULT_MARKET);

    const snapshot = await getUnifiedSnapshot(symbol, market, interval, userId);
    return NextResponse.json({ snapshot });
  } catch (e) {
    return handleError(e);
  }
}
