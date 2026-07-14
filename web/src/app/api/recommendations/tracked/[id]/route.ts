import { NextRequest, NextResponse } from "next/server";
import { requireUser, handleError, ApiError } from "@/lib/api";
import { getTrackedRecommendation } from "@/lib/recommendations/recommendationStore";

/** Authenticated recommendation details. No browser mutation authority. */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const recommendation = await getTrackedRecommendation(user.id, id);
    if (!recommendation) throw new ApiError(404, "Recommendation not found.");
    return NextResponse.json({ recommendation });
  } catch (err) {
    return handleError(err);
  }
}
