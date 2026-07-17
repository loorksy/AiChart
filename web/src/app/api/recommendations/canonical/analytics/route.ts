import { NextResponse } from "next/server";
import { handleError, requirePaidAccess } from "@/lib/api";
import { computeCanonicalRecommendationAnalytics } from "@/lib/recommendations/canonical";

/** Authenticated analytics derived only from canonical outcomes. */
export async function GET() {
  try {
    const user = await requirePaidAccess();
    return NextResponse.json(await computeCanonicalRecommendationAnalytics(user.id));
  } catch (error) {
    return handleError(error);
  }
}
