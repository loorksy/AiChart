/**
 * The operator's performance journal (docs/UNIFIED_AGENT_PLAN.md §15).
 *
 * Statistics existed for recommendations and for trades, but nothing connected
 * them — so the questions that actually change behaviour had no answer: does
 * this operator do better on the plans they take or the ones they skip? Do they
 * enter where the plan said? Do they move the stop?
 *
 * Two links make it answerable. A recommendation with a trade against it was
 * followed; one that reached a terminal state with no trade was ignored, and its
 * outcome is still known because the tracker evaluated it either way. That is
 * the comparison worth having: what following the plan produced versus what
 * skipping it would have.
 *
 * Descriptive only. This measures, and the agent may cite it as a personal
 * lesson — it never gates a recommendation.
 */
import { query } from "@/lib/db";
import type { TrackedRecommendationOutcome } from "./types";

export type FollowState = "followed_auto" | "followed_manual" | "ignored";

export interface JournalEntry {
  recommendationId: string;
  symbol: string;
  direction: "buy" | "sell";
  planType: string | null;
  outcome: TrackedRecommendationOutcome;
  followState: FollowState;
  /** Plan price vs the price actually filled, when both are known. */
  entryDeviation: number | null;
  /** True when the executed stop matched the plan's. */
  stopMatchedPlan: boolean | null;
  createdAt: number;
}

export interface JournalSummary {
  followed: { count: number; wins: number; losses: number };
  ignored: { count: number; wins: number; losses: number };
  auto: { count: number; wins: number };
  manual: { count: number; wins: number };
  /** Share of followed plans entered within a sane distance of the plan price. */
  entryAdherence: number | null;
  /** Share of followed plans whose stop matched the plan. */
  stopAdherence: number | null;
  /** Plain observations for the operator — never instructions. */
  notes: string[];
}

interface JoinedRow {
  id: string;
  symbol: string;
  direction: string;
  outcome: string;
  created_at: number;
  entry: number;
  stop_loss: number;
  trade_id: number | null;
  avg_price: number | null;
  intent_stop: number | null;
  authorization_source: string | null;
}

function isWin(outcome: string): boolean {
  return outcome.startsWith("win_");
}

function isResolved(outcome: string): boolean {
  return outcome !== "pending";
}

/**
 * Build the journal for one operator.
 *
 * Joins tracked recommendations to any trade opened from them; a missing trade
 * is the signal, not missing data.
 */
export async function buildPerformanceJournal(input: {
  userId: number;
  limit?: number;
}): Promise<{ entries: JournalEntry[]; summary: JournalSummary }> {
  const rows = await query<JoinedRow>(
    `SELECT r.id, r.symbol, r.direction, r.outcome, r.created_at, r.entry, r.stop_loss,
            t.id AS trade_id, t.avg_price AS avg_price,
            i.stop_loss AS intent_stop, i.authorization_source AS authorization_source
       FROM tracked_recommendations r
       LEFT JOIN trade_intents i ON i.recommendation_id = r.id
       LEFT JOIN trades t ON t.intent_id = i.id
      WHERE r.user_id = ?
      ORDER BY r.created_at DESC
      LIMIT ?`,
    [input.userId, input.limit ?? 200],
  ).catch(() => []);

  const entries: JournalEntry[] = rows.map((row) => {
    const followState: FollowState =
      row.trade_id == null
        ? "ignored"
        : row.authorization_source === "standing_auto"
          ? "followed_auto"
          : "followed_manual";

    const entryDeviation =
      row.avg_price != null && row.entry > 0
        ? Number((row.avg_price - row.entry).toFixed(6))
        : null;

    const stopMatchedPlan =
      row.intent_stop != null && row.stop_loss > 0
        ? Math.abs(row.intent_stop - row.stop_loss) <= Math.abs(row.stop_loss) * 0.0005
        : null;

    return {
      recommendationId: row.id,
      symbol: row.symbol,
      direction: row.direction === "sell" ? "sell" : "buy",
      planType: null,
      outcome: row.outcome as TrackedRecommendationOutcome,
      followState,
      entryDeviation,
      stopMatchedPlan,
      createdAt: Number(row.created_at),
    };
  });

  return { entries, summary: summarizeJournal(entries) };
}

/** Aggregate the entries into the comparisons worth making. */
export function summarizeJournal(entries: JournalEntry[]): JournalSummary {
  const resolved = entries.filter((entry) => isResolved(entry.outcome));
  const followed = resolved.filter((entry) => entry.followState !== "ignored");
  const ignored = resolved.filter((entry) => entry.followState === "ignored");
  const auto = resolved.filter((entry) => entry.followState === "followed_auto");
  const manual = resolved.filter((entry) => entry.followState === "followed_manual");

  const count = (list: JournalEntry[]) => ({
    count: list.length,
    wins: list.filter((entry) => isWin(entry.outcome)).length,
    losses: list.filter((entry) => !isWin(entry.outcome)).length,
  });

  const withDeviation = followed.filter((entry) => entry.entryDeviation != null);
  const closeEnough = withDeviation.filter(
    (entry) => Math.abs(entry.entryDeviation!) <= 0.001 * Math.max(1, Math.abs(entry.entryDeviation!) + 1),
  );
  const withStop = followed.filter((entry) => entry.stopMatchedPlan != null);

  const summary: JournalSummary = {
    followed: count(followed),
    ignored: count(ignored),
    auto: { count: auto.length, wins: auto.filter((e) => isWin(e.outcome)).length },
    manual: { count: manual.length, wins: manual.filter((e) => isWin(e.outcome)).length },
    entryAdherence: withDeviation.length ? closeEnough.length / withDeviation.length : null,
    stopAdherence: withStop.length
      ? withStop.filter((entry) => entry.stopMatchedPlan).length / withStop.length
      : null,
    notes: [],
  };

  summary.notes = buildNotes(summary);
  return summary;
}

/**
 * Observations, phrased as observations.
 *
 * "You do better on the plans you skip" is useful; "stop skipping plans" is a
 * rule, and rules belong to the operator. Nothing is said below a sample size
 * that could support it.
 */
function buildNotes(summary: JournalSummary): string[] {
  const notes: string[] = [];
  const MIN_SAMPLE = 5;

  const followedRate =
    summary.followed.count >= MIN_SAMPLE
      ? summary.followed.wins / summary.followed.count
      : null;
  const ignoredRate =
    summary.ignored.count >= MIN_SAMPLE
      ? summary.ignored.wins / summary.ignored.count
      : null;

  if (followedRate != null && ignoredRate != null) {
    const gap = followedRate - ignoredRate;
    if (Math.abs(gap) >= 0.15) {
      notes.push(
        gap > 0
          ? `التوصيات التي اتبعتها حققت ${Math.round(followedRate * 100)}% مقابل ${Math.round(ignoredRate * 100)}% لما تجاهلته.`
          : `التوصيات التي تجاهلتها كانت ستحقق ${Math.round(ignoredRate * 100)}% مقابل ${Math.round(followedRate * 100)}% لما اتبعته.`,
      );
    }
  }

  if (summary.stopAdherence != null && summary.stopAdherence < 0.7) {
    notes.push(
      `وقف الخسارة المنفَّذ طابق الخطة في ${Math.round(summary.stopAdherence * 100)}% من الصفقات فقط.`,
    );
  }

  if (
    summary.auto.count >= MIN_SAMPLE &&
    summary.manual.count >= MIN_SAMPLE
  ) {
    const autoRate = summary.auto.wins / summary.auto.count;
    const manualRate = summary.manual.wins / summary.manual.count;
    if (Math.abs(autoRate - manualRate) >= 0.15) {
      notes.push(
        autoRate > manualRate
          ? `التنفيذ التلقائي حقق ${Math.round(autoRate * 100)}% مقابل ${Math.round(manualRate * 100)}% للتنفيذ اليدوي.`
          : `تنفيذك اليدوي حقق ${Math.round(manualRate * 100)}% مقابل ${Math.round(autoRate * 100)}% للتنفيذ التلقائي.`,
      );
    }
  }

  return notes;
}

/** Which trading session a timestamp falls in, for the lessons feed. */
export function sessionOf(timestamp: number): "asia" | "london" | "newyork" {
  const hour = new Date(timestamp).getUTCHours();
  if (hour >= 7 && hour < 12) return "london";
  if (hour >= 12 && hour < 21) return "newyork";
  return "asia";
}
