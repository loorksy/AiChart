import { NextRequest, NextResponse } from "next/server";
import { requirePaidAccess, handleError } from "@/lib/api";
import { listTrackedRecommendations } from "@/lib/recommendations/recommendationStore";
import { toPublicTrackedRecommendation } from "@/lib/recommendations/publicEvidenceProjection";

/** Authenticated, owner-scoped read projection. Mutations are server-only. */
export async function GET(req: NextRequest) {
  try {
    const user = await requirePaidAccess();
    const limit = Number(req.nextUrl.searchParams.get("limit") ?? 500);
    const recommendations = await listTrackedRecommendations(user.id, {
      limit: Number.isFinite(limit) ? limit : 500,
    });
    // Owner-scoped, but still a BROWSER boundary: the internal evidence bundle
    // (legacy rows carry chart base64) never ships — only the card projection.
    return NextResponse.json({
      recommendations: recommendations.map(toPublicTrackedRecommendation),
    });
  } catch (err) {
    return handleError(err);
  }
}
