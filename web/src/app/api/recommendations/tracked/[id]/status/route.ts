import { NextRequest, NextResponse } from "next/server";
import { requireUser, handleError, ApiError } from "@/lib/api";
import { getTrackedRecommendation } from "@/lib/recommendations/recommendationStore";
import { trackOneRecommendation } from "@/lib/recommendations/recommendationTracker";

/** Re-evaluate a single recommendation against fresh candles (no LLM). */
export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const existing = await getTrackedRecommendation(user.id, id);
    if (!existing) throw new ApiError(404, "التوصية غير موجودة.");
    const recommendation = await trackOneRecommendation(existing);
    return NextResponse.json({ recommendation: recommendation ?? existing });
  } catch (err) {
    return handleError(err);
  }
}
