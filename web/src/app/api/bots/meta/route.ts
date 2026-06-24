import { NextRequest, NextResponse } from "next/server";
import { requirePlatformAccess, handleError } from "@/lib/api";
import { loadBotsMeta } from "@/lib/botsMeta";

export const dynamic = "force-dynamic";

/** Bots page: broker connection, demo/live env, live balance, symbol list. */
export async function GET(req: NextRequest) {
  try {
    const user = await requirePlatformAccess();
    const marketParam = req.nextUrl.searchParams.get("market");
    const market = marketParam === "crypto" ? "crypto" : "forex";
    return NextResponse.json(await loadBotsMeta(user.id, market));
  } catch (err) {
    return handleError(err);
  }
}
