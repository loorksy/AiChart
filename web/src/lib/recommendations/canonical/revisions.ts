/**
 * The effective revision (docs/UNIFIED_AGENT_PLAN.md §14, architecture §7).
 *
 * A recommendation is not a static row. Deep research finishes, structure
 * breaks, a release lands — and the plan's levels move. Without a notion of
 * "which version is in force", the monitor and the executor can act on numbers
 * the agent has already replaced, which is precisely the race the plan calls
 * out: a plan waiting to activate, a revision landing, and an executor filling
 * the old entry.
 *
 * So: every edit appends a revision and moves one pointer. Prior revisions stay
 * readable — the history is evidence and is never rewritten — but stop being
 * executable the moment the pointer moves. Execution re-reads the pointer under
 * the same lock that writes it, so a revision either lands before an order is
 * built or after it is placed, never in the middle.
 *
 * This module is the ONLY way a live recommendation's levels change. Detectors,
 * research, and monitors propose; the decision engine decides; this applies.
 */
import { createHash } from "node:crypto";
import { query, queryOne, transaction } from "@/lib/db";
import { withLock } from "@/lib/locks";
import { metrics } from "@/lib/metrics";
import { RecommendationLifecycleError, type RecommendationStatus } from "./types";
import {
  assertRecommendationTransition,
  isTerminalRecommendationStatus,
} from "./stateMachine";

/** Who asked for this change. Recorded so a plan's history reads honestly. */
export type RevisionSource =
  | "agent"
  | "deep_research"
  | "market_update"
  /**
   * Trade management syncing an already-open position with a revision the brain
   * produced (plan §14). The levels are never its own — it records that the
   * broker-side stop/target was brought in line with the effective plan.
   */
  | "trade_management"
  | "user";

export interface RecommendationRevision {
  id: number;
  recommendationId: number;
  userId: number;
  revisionNo: number;
  direction: "buy" | "sell";
  planType: string | null;
  executionState: string | null;
  entry: number | null;
  entryLow: number | null;
  entryHigh: number | null;
  stopLoss: number | null;
  targets: number[];
  activationCondition: string | null;
  invalidationRule: string | null;
  alternativeScenario: string | null;
  validityCandles: number | null;
  expiresAt: number | null;
  reason: string;
  source: RevisionSource;
  /** Fingerprint of the evidence bundle this revision was decided on. */
  evidenceHash: string | null;
  evidence: Record<string, unknown>;
  decisionTrace: Record<string, unknown>;
  createdAt: number;
}

export interface RevisionInput {
  direction: "buy" | "sell";
  planType?: string | null;
  executionState?: string | null;
  entry?: number | null;
  entryLow?: number | null;
  entryHigh?: number | null;
  stopLoss?: number | null;
  targets?: number[];
  activationCondition?: string | null;
  invalidationRule?: string | null;
  alternativeScenario?: string | null;
  validityCandles?: number | null;
  expiresAt?: number | null;
  reason: string;
  source: RevisionSource;
  /** The frozen evidence bundle behind the decision, if the caller has it. */
  evidence?: Record<string, unknown> | null;
  decisionTrace?: Record<string, unknown> | null;
}

interface RevisionRow {
  id: number;
  recommendation_id: number;
  user_id: number;
  revision_no: number;
  direction: string;
  plan_type: string | null;
  execution_state: string | null;
  entry: number | null;
  entry_low: number | null;
  entry_high: number | null;
  stop_loss: number | null;
  targets_json: string | null;
  activation_condition: string | null;
  invalidation_rule: string | null;
  alternative_scenario: string | null;
  validity_candles: number | null;
  expires_at: number | null;
  reason: string;
  source: string;
  evidence_hash: string | null;
  evidence_json: string | null;
  decision_trace_json: string | null;
  created_at: number;
}

const LOCK_TTL_MS = 15_000;

/** Serializes every read-modify-write on one recommendation across replicas. */
export function recommendationLockName(recommendationId: number): string {
  return `recommendation:${recommendationId}`;
}

/** Stable fingerprint of an evidence bundle, for comparing two revisions. */
export function evidenceFingerprint(evidence: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(evidence ?? null))
    .digest("hex")
    .slice(0, 16);
}

function parseJson<T>(text: string | null | undefined, fallback: T): T {
  if (!text) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

function toRevision(row: RevisionRow): RecommendationRevision {
  return {
    id: row.id,
    recommendationId: row.recommendation_id,
    userId: row.user_id,
    revisionNo: row.revision_no,
    direction: row.direction === "sell" ? "sell" : "buy",
    planType: row.plan_type,
    executionState: row.execution_state,
    entry: row.entry,
    entryLow: row.entry_low,
    entryHigh: row.entry_high,
    stopLoss: row.stop_loss,
    targets: parseJson<number[]>(row.targets_json, []),
    activationCondition: row.activation_condition,
    invalidationRule: row.invalidation_rule,
    alternativeScenario: row.alternative_scenario,
    validityCandles: row.validity_candles,
    expiresAt: row.expires_at,
    reason: row.reason,
    source: row.source as RevisionSource,
    evidenceHash: row.evidence_hash,
    evidence: parseJson<Record<string, unknown>>(row.evidence_json, {}),
    decisionTrace: parseJson<Record<string, unknown>>(row.decision_trace_json, {}),
    createdAt: Number(row.created_at),
  };
}

/**
 * Append a revision and make it the effective one.
 *
 * Refuses to touch a terminal recommendation: once a plan has hit its stop,
 * its target, or its expiry, what it said is history, not a draft.
 */
export async function applyRecommendationRevision(input: {
  userId: number;
  recommendationId: number;
  revision: RevisionInput;
  timestamp?: number;
}): Promise<RecommendationRevision> {
  const timestamp = input.timestamp ?? Date.now();
  const locked = await withLock(
    recommendationLockName(input.recommendationId),
    LOCK_TTL_MS,
    async () => writeRevision(input, timestamp),
  );
  if (!locked.ran) {
    throw new RecommendationLifecycleError(
      "RECOMMENDATION_ILLEGAL_TRANSITION",
      "Recommendation is being revised concurrently; try again",
    );
  }
  return locked.result!;
}

async function writeRevision(
  input: {
    userId: number;
    recommendationId: number;
    revision: RevisionInput;
  },
  timestamp: number,
): Promise<RecommendationRevision> {
  const r = input.revision;
  const evidenceHash = r.evidence ? evidenceFingerprint(r.evidence) : null;
  // Snapshot size is a dashboard, not a limit: a snapshot quietly growing past
  // hundreds of KB per revision is how storage surprises start.
  if (r.evidence) {
    metrics.evidenceSnapshotBytes.observe(JSON.stringify(r.evidence).length);
  }
  let revisionNo = 1;

  await transaction(async (db) => {
    const rows = await db.query<{ status: string | null; effective_revision_no: number | null }>(
      "SELECT status, effective_revision_no FROM recommendations WHERE id = ? AND user_id = ?",
      [input.recommendationId, input.userId],
    );
    const current = rows[0];
    if (!current) {
      throw new RecommendationLifecycleError(
        "RECOMMENDATION_NOT_FOUND",
        "Recommendation does not exist for this tenant",
      );
    }
    if (isTerminalRecommendationStatus((current.status ?? "draft") as RecommendationStatus)) {
      throw new RecommendationLifecycleError(
        "RECOMMENDATION_ILLEGAL_TRANSITION",
        "A finished recommendation cannot be revised",
      );
    }
    const invalidating = r.executionState === "invalidated";
    if (invalidating) {
      assertRecommendationTransition(
        (current.status ?? "draft") as RecommendationStatus,
        "invalidated",
      );
    }
    revisionNo = Number(current.effective_revision_no ?? 0) + 1;

    await db.execute(
      `INSERT INTO recommendation_revisions
        (recommendation_id, user_id, revision_no, direction, plan_type, execution_state,
         entry, entry_low, entry_high, stop_loss, targets_json, activation_condition,
         invalidation_rule, alternative_scenario, validity_candles, expires_at,
         reason, source, evidence_hash, evidence_json, decision_trace_json, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        input.recommendationId,
        input.userId,
        revisionNo,
        r.direction,
        r.planType ?? null,
        r.executionState ?? null,
        r.entry ?? null,
        r.entryLow ?? null,
        r.entryHigh ?? null,
        r.stopLoss ?? null,
        JSON.stringify(r.targets ?? []),
        r.activationCondition ?? null,
        r.invalidationRule ?? null,
        r.alternativeScenario ?? null,
        r.validityCandles ?? null,
        r.expiresAt ?? null,
        r.reason,
        r.source,
        evidenceHash,
        JSON.stringify(r.evidence ?? {}),
        JSON.stringify(r.decisionTrace ?? {}),
        timestamp,
      ],
    );

    // The pointer move is what actually retires the previous levels.
    await db.execute(
      `UPDATE recommendations
          SET effective_revision_no = ?, direction = ?, action = ?,
              plan_type = ?, execution_state = ?,
              entry = COALESCE(?, entry), stop_loss = COALESCE(?, stop_loss),
              targets_json = CASE WHEN ? = '[]' THEN targets_json ELSE ? END,
              expires_at = COALESCE(?, expires_at),
              status = CASE WHEN ? = 1 THEN 'invalidated' ELSE status END,
              status_reason = CASE WHEN ? = 1 THEN ? ELSE status_reason END,
              updated_at = ?
        WHERE id = ? AND user_id = ?`,
      [
        revisionNo,
        r.direction,
        r.direction,
        r.planType ?? null,
        r.executionState ?? null,
        r.entry ?? null,
        r.stopLoss ?? null,
        JSON.stringify(r.targets ?? []),
        JSON.stringify(r.targets ?? []),
        r.expiresAt ?? null,
        invalidating ? 1 : 0,
        invalidating ? 1 : 0,
        r.reason,
        timestamp,
        input.recommendationId,
        input.userId,
      ],
    );

    if (invalidating) {
      await db.execute(
        `INSERT INTO recommendation_transitions
          (recommendation_id, user_id, from_status, to_status, occurred_at,
           trigger_name, actor, source, reason, metadata_json)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [
          input.recommendationId,
          input.userId,
          current.status ?? "draft",
          "invalidated",
          timestamp,
          "brain_reevaluation",
          "agent",
          r.source,
          r.reason,
          JSON.stringify({
            revision_no: revisionNo,
            evidence_hash: evidenceHash,
          }),
        ],
      );
    }

    // Revisions are recorded as evidence too, so a replay shows what changed
    // and why without having to diff two snapshots by hand.
    await db.execute(
      `INSERT INTO recommendation_history
        (recommendation_id, user_id, kind, occurred_at, actor, source, payload_json)
       VALUES (?,?,?,?,?,?,?)`,
      [
        input.recommendationId,
        input.userId,
        "revision",
        timestamp,
        r.source === "user" ? "user" : "agent",
        r.source,
        JSON.stringify({
          revision_no: revisionNo,
          reason: r.reason,
          plan_type: r.planType ?? null,
          execution_state: r.executionState ?? null,
          entry: r.entry ?? null,
          stop_loss: r.stopLoss ?? null,
          targets: r.targets ?? [],
          evidence_hash: evidenceHash,
        }),
      ],
    );
  });

  const created = await getRevision(input.userId, input.recommendationId, revisionNo);
  if (!created) {
    throw new RecommendationLifecycleError(
      "RECOMMENDATION_NOT_FOUND",
      "Revision disappeared immediately after being written",
    );
  }
  return created;
}

export async function getRevision(
  userId: number,
  recommendationId: number,
  revisionNo: number,
): Promise<RecommendationRevision | null> {
  const row = await queryOne<RevisionRow>(
    `SELECT * FROM recommendation_revisions
      WHERE user_id = ? AND recommendation_id = ? AND revision_no = ?`,
    [userId, recommendationId, revisionNo],
  );
  return row ? toRevision(row) : null;
}

/** The revision currently in force, or null for pre-revision rows. */
export async function getEffectiveRevision(
  userId: number,
  recommendationId: number,
): Promise<RecommendationRevision | null> {
  const row = await queryOne<RevisionRow>(
    `SELECT r.* FROM recommendation_revisions r
       JOIN recommendations rec
         ON rec.id = r.recommendation_id
        AND rec.effective_revision_no = r.revision_no
      WHERE r.user_id = ? AND r.recommendation_id = ?`,
    [userId, recommendationId],
  );
  return row ? toRevision(row) : null;
}

export async function listRevisions(
  userId: number,
  recommendationId: number,
): Promise<RecommendationRevision[]> {
  const rows = await query<RevisionRow>(
    `SELECT * FROM recommendation_revisions
      WHERE user_id = ? AND recommendation_id = ?
      ORDER BY revision_no ASC`,
    [userId, recommendationId],
  );
  return rows.map(toRevision);
}

export interface RevisionCheck {
  ok: boolean;
  effectiveRevisionNo: number | null;
  reason?: "stale_revision" | "no_effective_revision" | "not_found";
}

/**
 * Compare-and-swap guard for execution: is the revision this order was built
 * from still the one in force?
 *
 * Callers MUST run this inside the recommendation lock (see
 * `recommendationLockName`), otherwise a revision can land between the check
 * and the order — which is the exact race this exists to close.
 */
export async function checkRevisionIsCurrent(input: {
  userId: number;
  recommendationId: number;
  revisionNo: number | null | undefined;
}): Promise<RevisionCheck> {
  const row = await queryOne<{ effective_revision_no: number | null }>(
    "SELECT effective_revision_no FROM recommendations WHERE id = ? AND user_id = ?",
    [input.recommendationId, input.userId],
  );
  if (!row) return { ok: false, effectiveRevisionNo: null, reason: "not_found" };
  const effective = row.effective_revision_no == null ? null : Number(row.effective_revision_no);
  if (effective == null) {
    // Written before revisions existed. Such a row is readable but is never
    // treated as executable, so an old plan cannot be auto-filled today.
    return { ok: false, effectiveRevisionNo: null, reason: "no_effective_revision" };
  }
  if (Number(input.revisionNo) !== effective) {
    return { ok: false, effectiveRevisionNo: effective, reason: "stale_revision" };
  }
  return { ok: true, effectiveRevisionNo: effective };
}
