import { NextRequest, NextResponse } from "next/server";
import { requireUser, handleError, ApiError } from "@/lib/api";
import {
  cancelTrackedRecommendation,
  getTrackedRecommendation,
} from "@/lib/recommendations/recommendationStore";

/** Recommendation details (owner-scoped). */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const recommendation = await getTrackedRecommendation(user.id, id);
    if (!recommendation) throw new ApiError(404, "التوصية غير موجودة.");
    return NextResponse.json({ recommendation });
  } catch (err) {
    return handleError(err);
  }
}

/** Cancel a recommendation (terminal records stay as they are). */
export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const recommendation = await cancelTrackedRecommendation(user.id, id);
    if (!recommendation) throw new ApiError(404, "التوصية غير موجودة.");
    return NextResponse.json({ recommendation });
  } catch (err) {
    return handleError(err);
  }
}
