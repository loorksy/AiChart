import { NextRequest, NextResponse } from "next/server";
import { requirePaidAccess, handleError } from "@/lib/api";
import { listTrackedRecommendations } from "@/lib/recommendations/recommendationStore";

/** Authenticated, owner-scoped read projection. Mutations are server-only. */
export async function GET(req: NextRequest) {
  try {
    const user = await requirePaidAccess();
    const limit = Number(req.nextUrl.searchParams.get("limit") ?? 500);
    const recommendations = await listTrackedRecommendations(user.id, {
      limit: Number.isFinite(limit) ? limit : 500,
    });
    return NextResponse.json({ recommendations });
  } catch (err) {
    return handleError(err);
  }
}
