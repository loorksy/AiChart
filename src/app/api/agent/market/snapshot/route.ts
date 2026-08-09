import { NextRequest, NextResponse } from "next/server";
import { resolveBridgeUserId } from "@/lib/agentAuth";
import { handleError } from "@/lib/api";
import { DEFAULT_MARKET, rejectNonForexMarket, resolveActiveMarket } from "@/lib/marketPolicy";
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
    const rawMarket = searchParams.get("market") ?? DEFAULT_MARKET;
    const marketErr = rejectNonForexMarket(rawMarket);
    if (marketErr) {
      return NextResponse.json({ error: marketErr }, { status: 400 });
    }
    const market = resolveActiveMarket(rawMarket ?? DEFAULT_MARKET);

    const snapshot = await getUnifiedSnapshot(symbol, market, interval, userId);
    // Every tool result names the book — a spread without its source is money lost.
    return NextResponse.json({
      snapshot,
      source: snapshot.extra?.source ?? null,
      book: snapshot.extra?.book ?? null,
    });
  } catch (e) {
    return handleError(e);
  }
}
