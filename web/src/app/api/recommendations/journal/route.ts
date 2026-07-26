import { NextResponse } from "next/server";
import { requirePlatformAccess, handleError } from "@/lib/api";
import { buildPerformanceJournal } from "@/lib/recommendations/performanceJournal";

/**
 * The operator's performance journal: what they followed, what they skipped,
 * what ran automatically, and how closely the executed trades matched the plans.
 *
 * Read-only and descriptive. Nothing here gates a recommendation — it exists so
 * the operator (and the agent, as a personal lesson) can see which behaviours
 * are actually paying.
 */
export async function GET() {
  try {
    const user = await requirePlatformAccess();
    const journal = await buildPerformanceJournal({ userId: user.id });
    return NextResponse.json({
      summary: journal.summary,
      entries: journal.entries.slice(0, 100),
    });
  } catch (err) {
    return handleError(err);
  }
}
