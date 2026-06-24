import { NextRequest, NextResponse } from "next/server";
import { requirePlatformAccess, handleError } from "@/lib/api";
import { searchBotSymbols } from "@/lib/botsMeta";

export const dynamic = "force-dynamic";

/** Searchable broker symbols with live quotes for the bots symbol picker. */
export async function GET(req: NextRequest) {
  try {
    const user = await requirePlatformAccess();
    const marketParam = req.nextUrl.searchParams.get("market");
    const market = marketParam === "crypto" ? "crypto" : "forex";
    const q = req.nextUrl.searchParams.get("q") ?? "";
    const limit = Math.min(
      Number(req.nextUrl.searchParams.get("limit")) || 120,
      500,
    );

    const { symbols, total, note_ar } = await searchBotSymbols(
      user.id,
      market,
      q,
      limit,
    );

    return NextResponse.json({ symbols, total, market, note_ar: note_ar ?? null });
  } catch (err) {
    return handleError(err);
  }
}
