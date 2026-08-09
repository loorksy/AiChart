import { NextRequest, NextResponse } from "next/server";
import { ApiError, handleError, requirePaidAccess } from "@/lib/api";
import { replayRecommendation } from "@/lib/recommendations/canonical";

/** Authenticated, tenant-scoped immutable recommendation replay. */
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requirePaidAccess();
    const { id } = await context.params;
    const recommendationId = Number(id);
    if (!Number.isInteger(recommendationId) || recommendationId <= 0) {
      throw new ApiError(400, "Invalid recommendation id.");
    }
    return NextResponse.json(await replayRecommendation(user.id, recommendationId));
  } catch (error) {
    return handleError(error);
  }
}
