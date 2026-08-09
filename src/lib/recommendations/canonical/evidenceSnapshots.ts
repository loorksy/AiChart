/**
 * The frozen evidence snapshot — what the brain actually decided on.
 *
 * A revision used to store only the graded evidence CARD
 * (`{ evidenceDimensions: [...] }`) while its `evidence_hash` claimed to be
 * "the fingerprint of the evidence bundle this revision was decided on". Those
 * were two different objects: the model reasoned over `modelContext` (numeric
 * level menu, trade candidates, chart geometry, execution cost, historical
 * cases) plus the chart images, and none of it was kept. So "what did it decide
 * on" had no answer, re-evaluation could not compare like with like, and the
 * parity log hashed a third object again.
 *
 * Two rules make the hash honest here:
 *
 *   1. The fingerprint is taken over a CANONICAL serialization (keys sorted at
 *      every depth), so two equal snapshots cannot hash differently because a
 *      producer happened to emit keys in another order.
 *   2. That exact canonical text is what gets stored. The stored bytes ARE the
 *      fingerprint input, so they cannot drift apart later.
 *
 * Rows are append-only (enforced by a DB trigger) and scoped by user_id, so a
 * snapshot belongs to exactly one operator's recommendation revision forever.
 */
import { createHash } from "node:crypto";

import { execute, queryOne } from "@/lib/db";

export interface EvidenceSnapshotRecord {
  userId: number;
  recommendationId: number;
  revisionNo: number;
  fingerprint: string;
  sourceSurface: string;
  schemaVersion: number;
  createdAt: number;
  snapshot: Record<string, unknown>;
}

/**
 * Deterministic JSON: object keys sorted at every depth, arrays left in order
 * (their order is meaningful — timeframes, candidates, cases).
 */
export function canonicalizeEvidence(value: unknown): string {
  return JSON.stringify(sortDeep(value));
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      const entry = source[key];
      // undefined is dropped by JSON anyway; dropping it here keeps the sorted
      // object identical to what JSON.stringify would have produced.
      if (entry !== undefined) out[key] = sortDeep(entry);
    }
    return out;
  }
  return value;
}

/** The fingerprint of a snapshot — always over its canonical form. */
export function evidenceSnapshotFingerprint(snapshot: unknown): string {
  return createHash("sha256").update(canonicalizeEvidence(snapshot)).digest("hex");
}

/**
 * Store the snapshot for one revision. Returns the fingerprint that was written
 * so the caller can put the SAME value on the revision row.
 *
 * Idempotent per (recommendation, revision): a retry of the same revision write
 * must not create a second snapshot, and must never overwrite the first.
 */
export async function storeEvidenceSnapshot(input: {
  userId: number;
  recommendationId: number;
  revisionNo: number;
  snapshot: Record<string, unknown>;
  sourceSurface: string;
  createdAt: number;
}): Promise<string> {
  const canonical = canonicalizeEvidence(input.snapshot);
  const fingerprint = createHash("sha256").update(canonical).digest("hex");
  const schemaVersion = Number(
    (input.snapshot as { schemaVersion?: unknown }).schemaVersion ?? 1,
  );
  await execute(
    `INSERT INTO recommendation_evidence_snapshots
       (user_id, recommendation_id, revision_no, fingerprint, source_surface,
        schema_version, snapshot_json, created_at)
     VALUES (?,?,?,?,?,?,?,?)
     ON CONFLICT (recommendation_id, revision_no) DO NOTHING`,
    [
      input.userId,
      input.recommendationId,
      input.revisionNo,
      fingerprint,
      input.sourceSurface,
      Number.isFinite(schemaVersion) ? schemaVersion : 1,
      canonical,
      input.createdAt,
    ],
  );
  return fingerprint;
}

interface SnapshotRow {
  user_id: number;
  recommendation_id: number;
  revision_no: number;
  fingerprint: string;
  source_surface: string;
  schema_version: number;
  snapshot_json: string;
  created_at: number;
}

/**
 * Read one revision's snapshot. User-scoped in the QUERY, never filtered after
 * the fact, so another operator's evidence cannot be reached by guessing an id.
 */
export async function getEvidenceSnapshot(
  userId: number,
  recommendationId: number,
  revisionNo: number,
): Promise<EvidenceSnapshotRecord | null> {
  const row = await queryOne<SnapshotRow>(
    `SELECT * FROM recommendation_evidence_snapshots
      WHERE user_id = ? AND recommendation_id = ? AND revision_no = ?`,
    [userId, recommendationId, revisionNo],
  );
  if (!row) return null;
  let snapshot: Record<string, unknown> = {};
  try {
    snapshot = JSON.parse(row.snapshot_json) as Record<string, unknown>;
  } catch {
    snapshot = {};
  }
  return {
    userId: Number(row.user_id),
    recommendationId: Number(row.recommendation_id),
    revisionNo: Number(row.revision_no),
    fingerprint: row.fingerprint,
    sourceSurface: row.source_surface,
    schemaVersion: Number(row.schema_version),
    createdAt: Number(row.created_at),
    snapshot,
  };
}

/**
 * Re-derive the fingerprint from what is actually stored and compare it to the
 * recorded one. Used by the audit path and the release gate: if these ever
 * disagree, the hash stopped describing the bytes.
 */
export async function verifyEvidenceSnapshot(
  userId: number,
  recommendationId: number,
  revisionNo: number,
): Promise<{ ok: boolean; stored: string | null; recomputed: string | null }> {
  const record = await getEvidenceSnapshot(userId, recommendationId, revisionNo);
  if (!record) return { ok: false, stored: null, recomputed: null };
  const recomputed = evidenceSnapshotFingerprint(record.snapshot);
  return { ok: recomputed === record.fingerprint, stored: record.fingerprint, recomputed };
}
