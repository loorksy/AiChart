import { NextRequest, NextResponse } from "next/server";
import { requireAgentAuth, resolveAgentUserId } from "@/lib/agentAuth";
import { handleError } from "@/lib/api";
import { getSettings } from "@/lib/store";
import { getUnifiedSnapshot } from "@/lib/markets";
import type { MarketType } from "@/lib/markets/types";

/** Bridge: live technical snapshot (price, RSI, MACD, SMA, trend). */
export async function GET(req: NextRequest) {
  try {
    requireAgentAuth(req);
    const userId = await resolveAgentUserId();
    const { searchParams } = new URL(req.url);
    const symbol = searchParams.get("symbol");
    if (!symbol) {
      return NextResponse.json({ error: "symbol مطلوب." }, { status: 400 });
    }
    const interval = searchParams.get("interval") ?? "1h";
    const settings = await getSettings(userId);
    const market = (searchParams.get("market") ??
      settings.active_market ??
      "crypto") as MarketType;

    const snapshot = await getUnifiedSnapshot(symbol, market, interval, userId);
    return NextResponse.json({ snapshot });
  } catch (e) {
    return handleError(e);
  }
}
