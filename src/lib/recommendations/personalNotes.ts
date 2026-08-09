/**
 * Personal notes from realised outcomes (docs/UNIFIED_AGENT_PLAN.md §15).
 *
 * The learning loop already phrases symbol-level history as evidence; this
 * adds the PERSONAL layer: which trading session this operator's results
 * actually land in, and what they actually returned — both read from real
 * rows, never estimated. The session comes from the recommendation's creation
 * time (Asia/London/New York), the return comes from `r_multiple` in
 * `recommendation_outcomes` as the tracker recorded it.
 *
 * Two rules carried over from the learning pipeline, not invented here:
 *
 *  - Below the pipeline's minimum sample there is NOTHING. A count is not a
 *    pattern, and a note built on three trades would be a superstition with a
 *    timestamp.
 *  - A note is an observation, never a veto. It feeds the existing lessons
 *    block — bounded, phrased as context to weigh — and the brain keeps sole
 *    authority over the direction.
 *
 * Notes worth keeping are persisted through the existing lesson storage
 * (`trade_lesson_candidates`), fingerprinted so a re-derivation updates the
 * row rather than stacking duplicates.
 */
import { execute, query, queryOne } from "@/lib/db";
import { createLogger } from "@/lib/logger";
import { FEATURES } from "@/lib/agent/featureFlags";
import type { LessonSummary, TradeOutcomeRecord } from "@/lib/agent/learningLoop";
import {
  DEFAULT_LESSON_MIN_CONFIDENCE,
  DEFAULT_LESSON_MIN_SAMPLE_SIZE,
} from "./canonical/tradeLessons";
import { sessionOf } from "./performanceJournal";

const log = createLogger("recommendations:personal-notes");

/** Same floor the lesson pipeline uses — fewer results say nothing. */
export const PERSONAL_NOTE_MIN_SAMPLE = DEFAULT_LESSON_MIN_SAMPLE_SIZE;
/** Same confidence gate: a session's result must be this one-sided to matter. */
export const PERSONAL_NOTE_MIN_SHARE = DEFAULT_LESSON_MIN_CONFIDENCE;
/** The lessons block is bounded; personal notes never widen it past this. */
export const MAX_PERSONAL_NOTES = 2;

export type TradingSession = "asia" | "london" | "newyork";

export interface PersonalNote {
  symbol: string;
  session: TradingSession;
  sampleSize: number;
  wins: number;
  losses: number;
  /** Share of the dominant result in this session (>= PERSONAL_NOTE_MIN_SHARE). */
  share: number;
  /** Mean realised R in this session, from recorded outcomes; null when none carried one. */
  averageR: number | null;
  /** The observation itself — factual, quantified, never a directive. */
  text: string;
  /** Stable identity for the persisted row. */
  fingerprint: string;
}

interface OutcomeRow {
  recommendation_id: number;
  outcome_type: string;
  r_multiple: number | null;
  occurred_at: number | string;
  symbol: string;
  direction: string;
  created_at: number | string;
}

/** created_at is a timestamp string on pg and an epoch-ish value on sqlite. */
function epochMs(value: number | string): number {
  if (typeof value === "number") return value;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export interface RealizedOutcome extends TradeOutcomeRecord {
  recommendationId: number;
}

/**
 * Resolved outcomes for one symbol, from the authoritative outcome rows.
 *
 * Only TP/SL resolutions count: an expired or cancelled plan says something
 * about patience, not about the session it was conceived in.
 */
export async function loadRealizedOutcomes(
  userId: number,
  symbol: string,
  limit = 60,
): Promise<RealizedOutcome[]> {
  const rows = await query<OutcomeRow>(
    `SELECT o.recommendation_id, o.outcome_type, o.r_multiple, o.occurred_at,
            r.symbol, r.direction, r.created_at
       FROM recommendation_outcomes o
       JOIN recommendations r
         ON r.id = o.recommendation_id AND r.user_id = o.user_id
      WHERE o.user_id = ? AND r.symbol = ?
        AND o.outcome_type IN ('TP1','TP2','TP3','SL')
      ORDER BY o.occurred_at DESC, o.id DESC LIMIT ?`,
    [userId, symbol.toUpperCase(), Math.max(1, Math.min(limit, 500))],
  ).catch(() => []);

  return rows.map((row) => ({
    recommendationId: Number(row.recommendation_id),
    symbol: row.symbol,
    direction: row.direction === "sell" ? "sell" : "buy",
    won: row.outcome_type.startsWith("TP"),
    rMultiple: row.r_multiple == null ? null : Number(row.r_multiple),
    // The ACTUAL session the plan was conceived in, from its creation time.
    session: sessionOf(epochMs(row.created_at)),
    closedAt: epochMs(row.occurred_at),
  }));
}

/**
 * Derive session notes. Pure — same outcomes, same notes.
 *
 * A note exists only when a session carries the pipeline's minimum sample AND
 * its result is one-sided past the pipeline's confidence gate. Everything else
 * is a count, and counts are not patterns.
 */
export function derivePersonalNotes(input: {
  symbol: string;
  outcomes: readonly RealizedOutcome[];
}): PersonalNote[] {
  const symbol = input.symbol.toUpperCase();
  const resolved = input.outcomes.filter((o) => o.symbol.toUpperCase() === symbol);
  if (resolved.length < PERSONAL_NOTE_MIN_SAMPLE) return [];

  const bySession = new Map<TradingSession, RealizedOutcome[]>();
  for (const outcome of resolved) {
    const session = (outcome.session ?? null) as TradingSession | null;
    if (!session) continue;
    bySession.set(session, [...(bySession.get(session) ?? []), outcome]);
  }

  const notes: PersonalNote[] = [];
  for (const [session, records] of bySession) {
    if (records.length < PERSONAL_NOTE_MIN_SAMPLE) continue;
    const wins = records.filter((o) => o.won).length;
    const losses = records.length - wins;
    const share = Math.max(wins, losses) / records.length;
    if (share < PERSONAL_NOTE_MIN_SHARE) continue;

    const rValues = records
      .map((o) => o.rMultiple)
      .filter((r): r is number => typeof r === "number" && Number.isFinite(r));
    const averageR = rValues.length
      ? rValues.reduce((a, b) => a + b, 0) / rValues.length
      : null;
    const result = wins >= losses ? "success" : "failure";

    notes.push({
      symbol,
      session,
      sampleSize: records.length,
      wins,
      losses,
      share,
      averageR,
      text:
        `نتائجك في جلسة ${session} على ${symbol}: ${wins} رابحة و${losses} خاسرة من ${records.length}` +
        (averageR != null ? ` بمتوسط عائد متحقق ${averageR.toFixed(2)}R.` : "."),
      fingerprint: `personal_note:${symbol.toLowerCase()}:${session}:${result}`,
    });
  }

  // Strongest signals first; the lessons block stays bounded either way.
  return notes
    .sort((a, b) => b.share - a.share || b.sampleSize - a.sampleSize)
    .slice(0, MAX_PERSONAL_NOTES);
}

/**
 * Persist notes through the existing lesson storage, keyed by fingerprint so a
 * fresh derivation UPDATES the observation instead of duplicating it. History
 * rows already stored are never deleted or reinterpreted.
 */
export async function persistPersonalNotes(
  userId: number,
  notes: readonly PersonalNote[],
  latestRecommendationId: number,
): Promise<void> {
  for (const note of notes) {
    const existing = await queryOne<{ id: number; status: string }>(
      "SELECT id, status FROM trade_lesson_candidates WHERE user_id = ? AND fingerprint = ?",
      [userId, note.fingerprint],
    ).catch(() => null);
    const confidence = Math.round(note.share * 10_000) / 10_000;
    if (existing) {
      // Validated/rejected rows are the operator's record — only a live
      // candidate is refreshed, mirroring the strategy-lesson upsert.
      if (existing.status !== "candidate") continue;
      await execute(
        `UPDATE trade_lesson_candidates
            SET recommendation_id = ?, reason = ?, confidence = ?,
                affected_symbols_json = ?, sample_size = ?
          WHERE id = ? AND user_id = ? AND status = 'candidate'`,
        [
          latestRecommendationId,
          note.text,
          confidence,
          JSON.stringify([note.symbol]),
          note.sampleSize,
          existing.id,
          userId,
        ],
      ).catch(() => undefined);
      continue;
    }
    await execute(
      `INSERT INTO trade_lesson_candidates
        (user_id, fingerprint, recommendation_id, status, reason,
         evidence_event_ids_json, strategy_id, market, confidence,
         affected_symbols_json, sample_size, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        userId,
        note.fingerprint,
        latestRecommendationId,
        "candidate",
        note.text,
        JSON.stringify([]),
        "personal_notes",
        "forex",
        confidence,
        JSON.stringify([note.symbol]),
        note.sampleSize,
        Date.now(),
      ],
    ).catch((error: unknown) => {
      // A lost note is a lost aid, never a lost decision.
      log.warn("failed to persist personal note", {
        fingerprint: note.fingerprint,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }
}

/**
 * Generate (and persist) this operator's notes for one symbol.
 *
 * Below the sample threshold this returns an empty array and writes nothing.
 * Gated by the performance-journal phase flag, whose rollback is documented as
 * "stops feeding personal notes into the lessons block".
 */
export async function generatePersonalNotes(
  userId: number,
  symbol: string,
): Promise<PersonalNote[]> {
  if (!FEATURES.performanceJournalV1()) return [];
  const outcomes = await loadRealizedOutcomes(userId, symbol);
  const notes = derivePersonalNotes({ symbol, outcomes });
  if (notes.length) {
    await persistPersonalNotes(userId, notes, outcomes[0]!.recommendationId).catch(
      () => undefined,
    );
  }
  return notes;
}

/**
 * Feed notes into an existing lessons summary — respecting its limits.
 *
 * An insufficient summary stays silent (its renderer already says why), and
 * the number of added lines is capped so the block cannot grow into a lecture.
 * Mutates and returns the same summary object, matching how the block is
 * built inline in the orchestrator.
 */
export function feedLessonsSummary(
  summary: LessonSummary,
  notes: readonly PersonalNote[],
): LessonSummary {
  if (summary.insufficient || !notes.length) return summary;
  for (const note of notes.slice(0, MAX_PERSONAL_NOTES)) {
    summary.notes.push(note.text);
  }
  return summary;
}

/**
 * The one-call form the orchestrator uses when composing the lessons block.
 * Failure degrades to the unmodified summary — history is an aid, never a gate.
 */
export async function appendPersonalNotes(
  userId: number | undefined,
  symbol: string,
  summary: LessonSummary,
): Promise<LessonSummary> {
  if (!userId || !symbol || summary.insufficient) return summary;
  try {
    return feedLessonsSummary(summary, await generatePersonalNotes(userId, symbol));
  } catch (error) {
    log.warn("personal notes unavailable", {
      error: error instanceof Error ? error.message : String(error),
    });
    return summary;
  }
}
