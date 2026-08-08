import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, handleError } from "@/lib/api";
import { resolveQuantAgentUserId } from "@/lib/quantAgent/webAuth";
import { rejectNonForexMarket, resolveActiveMarket } from "@/lib/marketPolicy";
import { addToWatchlist, listWatchlist } from "@/lib/quantAgent/watchlistStore";

/**
 * Quant Agent Watchlist CRUD (plan §A6). Mirrors
 * `api/quant-agent/chat/sessions/route.ts`'s convention exactly:
 * `resolveQuantAgentUserId` → zod `.parse()` → store call → `NextResponse.json`.
 */

const createSchema = z.object({
  symbol: z.string().trim().min(1).max(32),
  market: z.string().trim().max(16).optional(),
});

/** List the current user's watchlist. */
export async function GET(req: NextRequest) {
  try {
    const userId = await resolveQuantAgentUserId(req);
    const items = await listWatchlist(userId);
    return NextResponse.json({ items });
  } catch (err) {
    return handleError(err);
  }
}

/** Add a symbol to the current user's watchlist (idempotent). */
export async function POST(req: NextRequest) {
  try {
    const userId = await resolveQuantAgentUserId(req);
    const body = createSchema.parse(await req.json().catch(() => ({})));
    const marketErr = rejectNonForexMarket(body.market);
    if (marketErr) throw new ApiError(400, marketErr);
    const market = resolveActiveMarket(body.market);
    const item = await addToWatchlist(userId, body.symbol, market);
    return NextResponse.json({ item }, { status: 201 });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.issues[0]?.message ?? "Invalid request." }, { status: 400 });
    }
    return handleError(err);
  }
}
