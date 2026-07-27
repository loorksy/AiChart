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
import { FEATURES } from "@/lib/agent/featureFlags";
import {
  ADHERENCE_PRICE_TOLERANCE,
  summarizeAdherence,
} from "./canonical/analytics";
import type { TrackedRecommendationOutcome } from "./types";

export type FollowState = "followed_auto" | "followed_manual" | "ignored";

export interface JournalEntry {
  recommendationId: string;
  symbol: string;
  direction: "buy" | "sell";
  planType: string | null;
  outcome: TrackedRecommendationOutcome;
  followState: FollowState;
  /**
   * Fill price minus plan price, as a FRACTION of the plan price. Relative so
   * one adherence threshold means the same thing on EURUSD and on XAUUSD.
   */
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
  /**
   * Followed plans whose order was raised after the canonical delayed-entry
   * threshold. Counts come from `summarizeAdherence` — the UI must not recompute.
   */
  delayedEntryCount: number;
  /** Followed plans closed manually before any target paid. */
  earlyExitCount: number;
  /** Plain observations for the operator — never instructions. */
  notes: string[];
}

interface JoinedRow {
  id: number | string;
  symbol: string;
  direction: string;
  plan_type: string | null;
  status: string;
  created_at: number | string;
  entry: number | null;
  stop_loss: number | null;
  /** The plan as it stood when the intent executed — see the query below. */
  planned_entry: number | null;
  planned_stop: number | null;
  executed_revision_no: number | null;
  outcome_type: string | null;
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
 * Map a canonical status/outcome pair onto the journal's outcome vocabulary.
 *
 * The outcome row is authoritative when present; the status carries the answer
 * for a plan that ended without ever being filled, which is precisely the case
 * the followed-vs-ignored comparison depends on.
 */
function journalOutcome(row: JoinedRow): TrackedRecommendationOutcome {
  switch (row.outcome_type) {
    case "TP1":
      return "win_tp1";
    case "TP2":
      return "win_tp2";
    case "TP3":
      return "win_tp3";
    case "SL":
      return "loss";
    case "Invalidated":
      return "invalidated";
    case "Cancelled":
      return "cancelled";
    case "Expired":
      return "expired";
    default:
      break;
  }
  switch (row.status) {
    case "tp1_hit":
      return "win_tp1";
    case "tp2_hit":
      return "win_tp2";
    case "tp3_hit":
      return "win_tp3";
    case "sl_hit":
      return "loss";
    case "invalidated":
      return "invalidated";
    case "cancelled":
      return "cancelled";
    case "expired":
      return "expired";
    default:
      return "pending";
  }
}

/**
 * Relative tolerance for "entered where the plan said" / "kept the plan's stop".
 * One constant, owned by the canonical analytics module, so the deviation
 * recorded here and the adherence aggregated there can never drift apart.
 */
const PRICE_TOLERANCE = ADHERENCE_PRICE_TOLERANCE;

/**
 * Build the journal for one operator.
 *
 * Reads the CANONICAL recommendations table joined to any intent and trade
 * raised against it. The earlier version read `tracked_recommendations`, which is
 * the retired legacy table — nothing writes to it, and its TEXT id could never
 * match `trade_intents.recommendation_id` (an INTEGER canonical id), so every
 * entry classified as "ignored" and the whole comparison was silently empty.
 *
 * A recommendation with no trade was ignored; that absence is the signal, not
 * missing data. Rows are collapsed per recommendation because one plan can raise
 * several intents, and counting a plan once per intent would inflate every
 * number in the summary.
 */
export async function buildPerformanceJournal(input: {
  userId: number;
  limit?: number;
}): Promise<{ entries: JournalEntry[]; summary: JournalSummary }> {
  // Gated by PERFORMANCE_JOURNAL_V1. Read-only and descriptive, so off simply
  // returns an empty journal — it never gated a recommendation, and there is
  // nothing else to withdraw.
  if (!FEATURES.performanceJournalV1()) {
    return { entries: [], summary: summarizeJournal([]) };
  }

  const limit = input.limit ?? 200;
  const rows = await query<JoinedRow>(
    // Adherence is measured against the revision that was IN FORCE when the
    // intent executed, joined through trade_intents.recommendation_revision_no.
    // Reading r.entry / r.stop_loss instead would measure against the newest
    // revision, because writeRevision overwrites exactly those columns — so a
    // plan revised after the fill looked like the operator had disobeyed it.
    `SELECT r.id, r.symbol, r.direction, r.plan_type, r.status, r.created_at,
            r.entry, r.stop_loss,
            rev.entry AS planned_entry, rev.stop_loss AS planned_stop,
            i.recommendation_revision_no AS executed_revision_no,
            o.outcome_type AS outcome_type,
            t.id AS trade_id, t.avg_price AS avg_price,
            i.stop_loss AS intent_stop, i.authorization_source AS authorization_source
       FROM recommendations r
       LEFT JOIN recommendation_outcomes o
         ON o.recommendation_id = r.id AND o.user_id = r.user_id
       LEFT JOIN trade_intents i
         ON i.recommendation_id = r.id AND i.user_id = r.user_id
       LEFT JOIN trades t ON t.intent_id = i.id
       LEFT JOIN recommendation_revisions rev
         ON rev.recommendation_id = r.id AND rev.user_id = r.user_id
        AND rev.revision_no = i.recommendation_revision_no
      WHERE r.user_id = ? AND r.direction IN ('buy','sell')
      ORDER BY r.id DESC`,
    [input.userId],
  ).catch(() => []);

  // One entry per recommendation. The first row that carries a filled trade wins,
  // since a plan that was acted on is "followed" even if other intents lapsed.
  const byRecommendation = new Map<string, JournalEntry>();
  for (const row of rows) {
    const id = String(row.id);
    const existing = byRecommendation.get(id);
    if (existing && existing.followState !== "ignored") continue;

    const followState: FollowState =
      row.trade_id == null
        ? "ignored"
        : row.authorization_source === "standing_auto"
          ? "followed_auto"
          : "followed_manual";

    // Fall back to the row only for plans that never carried a revision at
    // all (pre-revision history); never for a revised plan, or the deviation
    // would be measured against levels the operator never saw.
    const plannedEntry = row.planned_entry ?? row.entry;
    const plannedStop = row.planned_stop ?? row.stop_loss;

    const entryDeviation =
      row.avg_price != null && plannedEntry != null && plannedEntry > 0
        ? Number(((row.avg_price - plannedEntry) / plannedEntry).toFixed(6))
        : null;

    const stopMatchedPlan =
      row.intent_stop != null && plannedStop != null && plannedStop > 0
        ? Math.abs(row.intent_stop - plannedStop) <= Math.abs(plannedStop) * PRICE_TOLERANCE
        : null;

    const entry: JournalEntry = {
      recommendationId: id,
      symbol: row.symbol,
      direction: row.direction === "sell" ? "sell" : "buy",
      planType: row.plan_type,
      outcome: journalOutcome(row),
      followState,
      entryDeviation,
      stopMatchedPlan,
      createdAt: epochMs(row.created_at),
    };
    if (!existing || followState !== "ignored") byRecommendation.set(id, entry);
  }

  const entries = [...byRecommendation.values()]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit);
  return { entries, summary: summarizeJournal(entries) };
}

/** created_at is a timestamp string on pg and an epoch-ish value on sqlite. */
function epochMs(value: number | string): number {
  if (typeof value === "number") return value;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
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

  // Adherence aggregates (including delayed/early counts) live in canonical
  // analytics. The journal supplies the followed rows; it does not own thresholds.
  const adherence = summarizeAdherence({
    entries: followed,
    entryDelayMsList: [],
    earlyExitFlags: [],
  });

  const summary: JournalSummary = {
    followed: count(followed),
    ignored: count(ignored),
    auto: { count: auto.length, wins: auto.filter((e) => isWin(e.outcome)).length },
    manual: { count: manual.length, wins: manual.filter((e) => isWin(e.outcome)).length },
    entryAdherence: adherence.entryAdherence,
    stopAdherence: adherence.stopAdherence,
    delayedEntryCount: 0,
    earlyExitCount: 0,
    notes: [],
  };

  summary.notes = buildNotes(summary);
  return summary;
}

/**
 * Merge lifecycle adherence facts (delay / early exit) into a journal summary.
 * Kept separate from `summarizeJournal` so the pure journal path stays free of
 * DB fact maps while the API still returns one coherent summary object.
 */
export function attachAdherenceToSummary(
  summary: JournalSummary,
  input: {
    entries: readonly JournalEntry[];
    entryDelayMsById: ReadonlyMap<string, number>;
    earlyExitIds: ReadonlySet<string>;
  },
): JournalSummary {
  const followed = input.entries.filter(
    (entry) => entry.followState !== "ignored" && isResolved(entry.outcome),
  );
  const adherence = summarizeAdherence({
    entries: followed,
    entryDelayMsList: followed.map(
      (entry) => input.entryDelayMsById.get(entry.recommendationId) ?? null,
    ),
    earlyExitFlags: followed.map((entry) =>
      input.earlyExitIds.has(entry.recommendationId),
    ),
  });
  return {
    ...summary,
    entryAdherence: adherence.entryAdherence ?? summary.entryAdherence,
    stopAdherence: adherence.stopAdherence ?? summary.stopAdherence,
    delayedEntryCount: adherence.delayedEntryCount,
    earlyExitCount: adherence.earlyExitCount,
  };
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
