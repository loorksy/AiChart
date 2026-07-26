import { NextResponse } from "next/server";
import { requirePlatformAccess, handleError } from "@/lib/api";
import { collectAdherenceFacts } from "@/lib/recommendations/canonical/analytics";
import {
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
 * The route enriches each entry with facts the journal page needs but the core
 * journal does not compute: the realised R multiple (from the recorded
 * outcome), whether the trade was closed manually before the plan paid any
 * target (early exit), and how long after activation the order was actually
 * raised (delayed entry). The facts themselves come from the canonical
 * analytics module (`canonical/analytics.ts`), which is their one home.
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
      summary: journal.summary,
      entries: enriched,
    });
  } catch (err) {
    return handleError(err);
  }
}
