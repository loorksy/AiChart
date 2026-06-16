import { NextRequest, NextResponse } from "next/server";
import { resolveBridgeUserId } from "@/lib/agentAuth";
import { handleError } from "@/lib/api";
import {
  searchSimilarLessons,
  listRecentLessons,
} from "@/lib/tradeMemory";

/**
 * Bridge: semantic search over post-mortem trade lessons.
 */
export async function GET(req: NextRequest) {
  try {
    const userId = await resolveBridgeUserId(req);
    const symbol = req.nextUrl.searchParams.get("symbol") ?? undefined;
    const pattern = req.nextUrl.searchParams.get("pattern") ?? undefined;
    const limit = Number(req.nextUrl.searchParams.get("limit") ?? "3");
    const recentOnly = req.nextUrl.searchParams.get("recent") === "1";

    if (recentOnly) {
      const lessons = await listRecentLessons(userId, limit);
      return NextResponse.json({ ok: true, lessons });
    }

    const lessons = await searchSimilarLessons(userId, {
      symbol,
      pattern,
      limit: Number.isFinite(limit) ? limit : 3,
    });
    return NextResponse.json({ ok: true, lessons });
  } catch (e) {
    return handleError(e);
  }
}
