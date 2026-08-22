import { NextResponse } from "next/server";
import { handleError, requireUser } from "@/lib/api";
import { readRecommendationCounters } from "@/lib/recommendations/usageCounters";

/**
 * Recommendation creations by decision path (platform_agent | mcp_client) for
 * the signed-in user. A counter only — informational, never a quota.
 */
export async function GET() {
  try {
    const user = await requireUser();
    const counters = await readRecommendationCounters(user.id);
    return NextResponse.json({
      counters: counters.map((counter) => ({
        decision_source: counter.decisionSource,
        count: counter.count,
        updated_at: counter.updatedAt,
      })),
      total: counters.reduce((sum, counter) => sum + counter.count, 0),
    });
  } catch (err) {
    return handleError(err);
  }
}
