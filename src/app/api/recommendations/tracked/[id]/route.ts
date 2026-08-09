import { NextRequest, NextResponse } from "next/server";
import { requirePaidAccess, handleError, ApiError } from "@/lib/api";
import { getTrackedRecommendation } from "@/lib/recommendations/recommendationStore";
import { toPublicTrackedRecommendation } from "@/lib/recommendations/publicEvidenceProjection";

/** Authenticated recommendation details. No browser mutation authority. */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requirePaidAccess();
    const { id } = await ctx.params;
    const recommendation = await getTrackedRecommendation(user.id, id);
    if (!recommendation) throw new ApiError(404, "Recommendation not found.");
    // Browser boundary: the internal bundle (legacy rows carry chart base64)
    // never ships — the UI renders the projection, not the raw evidence.
    return NextResponse.json({
      recommendation: toPublicTrackedRecommendation(recommendation),
    });
  } catch (err) {
    return handleError(err);
  }
}
