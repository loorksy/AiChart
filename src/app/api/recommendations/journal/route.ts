import { NextResponse } from "next/server";
import { requirePlatformAccess, handleError } from "@/lib/api";
import { collectAdherenceFacts } from "@/lib/recommendations/canonical/analytics";
import {
  attachAdherenceToSummary,
  buildPerformanceJournal,
  type JournalEntry,
} from "@/lib/recommendations/performanceJournal";

/**
 * The operator's performance journal: what they followed, what they skipped,
 * what ran automatically, and how closely the executed trades matched the plans.
 *
 * Read-only and descriptive. Nothing here gates a recommendation — it exists so
 * the operator (and the agent, as a personal lesson) can see which behaviours
 * are actually paying.
 *
 * Per-entry facts and summary counts for delayed entry / early exit come from
 * `canonical/analytics.ts`. This route only joins them onto the response.
 */

export interface JournalEntryView extends JournalEntry {
  rMultiple: number | null;
  earlyExit: boolean;
  /** Milliseconds between plan activation and the order being raised. */
  entryDelayMs: number | null;
}

export async function GET() {
  try {
    const user = await requirePlatformAccess();
    const journal = await buildPerformanceJournal({ userId: user.id });
    const entries = journal.entries.slice(0, 100);

    const facts = await collectAdherenceFacts(user.id);

    const enriched: JournalEntryView[] = entries.map((entry) => ({
      ...entry,
      rMultiple: facts.rMultipleById.get(entry.recommendationId) ?? null,
      earlyExit:
        entry.followState !== "ignored" &&
        facts.earlyExitIds.has(entry.recommendationId),
      entryDelayMs:
        entry.followState !== "ignored"
          ? facts.entryDelayMsById.get(entry.recommendationId) ?? null
          : null,
    }));

    return NextResponse.json({
      summary: attachAdherenceToSummary(journal.summary, {
        entries,
        entryDelayMsById: facts.entryDelayMsById,
        earlyExitIds: facts.earlyExitIds,
      }),
      entries: enriched,
    });
  } catch (err) {
    return handleError(err);
  }
}
