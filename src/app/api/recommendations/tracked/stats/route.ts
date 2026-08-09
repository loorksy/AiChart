import { NextRequest, NextResponse } from "next/server";
import { requirePaidAccess, handleError } from "@/lib/api";
import { listTrackedRecommendations } from "@/lib/recommendations/recommendationStore";
import {
  computeRecommendationStats,
  filterByPeriod,
  type StatsPeriod,
} from "@/lib/recommendations/recommendationStats";

const PERIODS: StatsPeriod[] = ["today", "7d", "30d", "all"];

/** Statistics computed from tracked outcomes only (never from chat text). */
export async function GET(req: NextRequest) {
  try {
    const user = await requirePaidAccess();
    const raw = req.nextUrl.searchParams.get("period") ?? "all";
    const period: StatsPeriod = (PERIODS as string[]).includes(raw)
      ? (raw as StatsPeriod)
      : "all";
    const all = await listTrackedRecommendations(user.id, { limit: 2000 });
    const stats = computeRecommendationStats(filterByPeriod(all, period));
    return NextResponse.json({ period, stats });
  } catch (err) {
    return handleError(err);
  }
}
