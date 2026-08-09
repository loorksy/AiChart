import { NextRequest, NextResponse } from "next/server";
import { requireAgentAuth } from "@/lib/agentAuth";
import { handleError } from "@/lib/api";
import { profileForInterval } from "@/lib/analysisProfile";
import { fetchMarketContext, formatContextForPrompt } from "@/lib/marketContext";

/** Bridge: news, fear & greed, and market mood for a symbol/timeframe. */
export async function GET(req: NextRequest) {
  try {
    requireAgentAuth(req);
    const { searchParams } = new URL(req.url);
    const symbol = searchParams.get("symbol");
    if (!symbol) {
      return NextResponse.json({ error: "symbol مطلوب." }, { status: 400 });
    }
    const interval = searchParams.get("interval") ?? "1h";
    const profile = profileForInterval(interval);
    const ctx = await fetchMarketContext(symbol, profile);
    return NextResponse.json({
      profile: profile.labelAr,
      context: formatContextForPrompt(ctx),
      headlines: ctx.headlines.slice(0, 5),
      fearGreed: ctx.fearGreed ?? null,
    });
  } catch (e) {
    return handleError(e);
  }
}
