import { NextRequest, NextResponse } from "next/server";
import { resolveBridgeUserId } from "@/lib/agentAuth";
import { handleError } from "@/lib/api";
import { getEaLiveQuotes } from "@/lib/eaLiveState";

/** Bridge: EA live quote cache with freshness (quoteAgeMs). */
export async function GET(req: NextRequest) {
  try {
    const userId = await resolveBridgeUserId(req);
    const symbol = req.nextUrl.searchParams.get("symbol")?.toUpperCase().trim();
    const quotes = getEaLiveQuotes(userId);

    if (symbol) {
      const q = quotes[symbol];
      return NextResponse.json({
        symbol,
        quote: q ?? null,
        quotesOk: Boolean(q && q.bid > 0 && q.ask > 0),
        quoteAgeMs: q?.quoteAgeMs ?? null,
      });
    }

    return NextResponse.json({ quotes, count: Object.keys(quotes).length });
  } catch (e) {
    return handleError(e);
  }
}
