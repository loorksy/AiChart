import { NextResponse } from "next/server";
import { requireUser, handleError } from "@/lib/api";
import { trackRecommendations } from "@/lib/recommendations/recommendationTracker";

/**
 * Sweep the current user's active recommendations against fresh warehouse
 * candles and persist any status/outcome changes. Works without a live browser
 * session (can also be driven by a scheduled job at the account level).
 */
export async function POST() {
  try {
    const user = await requireUser();
    const summary = await trackRecommendations({ userId: user.id });
    return NextResponse.json(summary);
  } catch (err) {
    return handleError(err);
  }
}
