import { NextRequest, NextResponse } from "next/server";
import { requireUser, handleError } from "@/lib/api";
import { getLatestTrackedRecommendationForSession } from "@/lib/recommendations/recommendationStore";
import { chartLifecycleOf } from "@/lib/recommendations/chartLifecycle";

/**
 * Lifecycle of the plan issued from ONE chat session, for the live chart:
 * the P/L box widens only after the entry filled and freezes once the trade
 * ended, so the tab needs the tracker's verdict (status / fill / exit) for
 * the plan it is painting. Owner-scoped, read-only, no market data fetched —
 * the sweep grades; this route only reports.
 */
export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const chatId = req.nextUrl.searchParams.get("chatId")?.trim() ?? "";
    if (!chatId || chatId.length > 64) {
      return NextResponse.json({ recommendation: null });
    }
    const rec = await getLatestTrackedRecommendationForSession(user.id, chatId);
    return NextResponse.json({ recommendation: rec ? chartLifecycleOf(rec) : null });
  } catch (err) {
    return handleError(err);
  }
}
