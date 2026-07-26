import { NextResponse } from "next/server";
import { requirePlatformAccess, handleError } from "@/lib/api";
import { query } from "@/lib/db";
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
 * outcome), whether the trade was closed manually before the plan finished
 * (early exit), and how long after activation the order was actually raised
 * (delayed entry). All read-only joins over existing tables.
 */

export interface JournalEntryView extends JournalEntry {
  rMultiple: number | null;
  earlyExit: boolean;
  /** Milliseconds between plan activation and the order being raised. */
  entryDelayMs: number | null;
}

interface OutcomeRow {
  recommendation_id: number | string;
  outcome_type: string;
  r_multiple: number | string | null;
  occurred_at: number | string;
}

interface TriggeredRow {
  recommendation_id: number | string;
  occurred_at: number | string;
}

interface IntentRow {
  recommendation_id: number | string;
  created_at: number | string | null;
}

/** Timestamps are epoch-ish on sqlite and timestamp strings on pg. */
function toMs(value: number | string | null): number | null {
  if (value == null) return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

export async function GET() {
  try {
    const user = await requirePlatformAccess();
    const journal = await buildPerformanceJournal({ userId: user.id });
    const entries = journal.entries.slice(0, 100);

    const [outcomeRows, triggeredRows, intentRows] = await Promise.all([
      query<OutcomeRow>(
        `SELECT recommendation_id, outcome_type, r_multiple, occurred_at
           FROM recommendation_outcomes WHERE user_id = ?
          ORDER BY occurred_at DESC`,
        [user.id],
      ).catch(() => [] as OutcomeRow[]),
      query<TriggeredRow>(
        `SELECT recommendation_id, occurred_at FROM recommendation_transitions
          WHERE user_id = ? AND to_status = 'triggered'`,
        [user.id],
      ).catch(() => [] as TriggeredRow[]),
      query<IntentRow>(
        `SELECT i.recommendation_id, t.created_at
           FROM trade_intents i JOIN trades t ON t.intent_id = i.id
          WHERE i.user_id = ? AND i.recommendation_id IS NOT NULL`,
        [user.id],
      ).catch(() => [] as IntentRow[]),
    ]);

    // Newest-first, so the first r_multiple seen per plan is the latest.
    const rById = new Map<string, number>();
    const earlyExitById = new Set<string>();
    for (const row of outcomeRows) {
      const id = String(row.recommendation_id);
      const r = Number(row.r_multiple);
      if (!rById.has(id) && row.r_multiple != null && Number.isFinite(r)) rById.set(id, r);
      if (row.outcome_type === "ManualClose") earlyExitById.add(id);
    }

    const triggeredAtById = new Map<string, number>();
    for (const row of triggeredRows) {
      const at = toMs(row.occurred_at);
      const id = String(row.recommendation_id);
      // Keep the FIRST activation: a delayed entry is measured from the moment
      // the plan first became enterable.
      if (at != null && (!triggeredAtById.has(id) || at < triggeredAtById.get(id)!)) {
        triggeredAtById.set(id, at);
      }
    }

    const tradeAtById = new Map<string, number>();
    for (const row of intentRows) {
      const at = toMs(row.created_at);
      const id = String(row.recommendation_id);
      if (at != null && (!tradeAtById.has(id) || at < tradeAtById.get(id)!)) {
        tradeAtById.set(id, at);
      }
    }

    const enriched: JournalEntryView[] = entries.map((entry) => {
      const triggeredAt = triggeredAtById.get(entry.recommendationId) ?? null;
      const tradeAt = tradeAtById.get(entry.recommendationId) ?? null;
      const entryDelayMs =
        entry.followState !== "ignored" && triggeredAt != null && tradeAt != null
          ? Math.max(0, tradeAt - triggeredAt)
          : null;
      return {
        ...entry,
        rMultiple: rById.get(entry.recommendationId) ?? null,
        earlyExit:
          entry.followState !== "ignored" && earlyExitById.has(entry.recommendationId),
        entryDelayMs,
      };
    });

    return NextResponse.json({
      summary: journal.summary,
      entries: enriched,
    });
  } catch (err) {
    return handleError(err);
  }
}
