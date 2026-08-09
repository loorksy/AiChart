/**
 * pgvector bridge for the case memory (plan phase G infra).
 *
 * On Postgres with the vector extension, similar-case candidates come back
 * KNN-ordered by `embedding <-> query` — the nearest moments are guaranteed
 * into the candidate cap instead of merely the most recent ones. Everything
 * downstream (weighted similarity, thresholds, minimum-sample discipline) is
 * the SAME code either way, so the two paths can only differ in which
 * candidates they read, never in what they claim about them.
 *
 * On SQLite, or on a Postgres without the extension, nothing here applies:
 * the probe answers false once, warns once, and the JS feature-distance path
 * carries the query unchanged. Degradation is silent to the caller and loud
 * in the log — never a crash.
 */
import { execute, getDbBackend, query } from "@/lib/db";
import { createLogger } from "@/lib/logger";
import {
  fingerprintVector,
  type CaseFingerprint,
  type RangeZone,
  type Regime,
  type Session,
  type Trend,
} from "./caseFingerprint";

const log = createLogger("marketMemory:vector");

/**
 * Dimension of the stored embedding — the fingerprint feature vector's length.
 * Must match the `vector(N)` DDL on market_cases.embedding (lib/db/pg.ts).
 */
export const CASE_EMBEDDING_DIM = 8;

/** pgvector input literal for one fingerprint, e.g. "[1,0.5,0,...]". */
export function caseEmbeddingLiteral(fingerprint: CaseFingerprint): string {
  const vector = fingerprintVector(fingerprint);
  if (vector.length !== CASE_EMBEDDING_DIM) {
    // The fingerprint contract changed without the column following: refusing
    // loudly beats silently storing vectors the index cannot compare.
    throw new Error(
      `fingerprint vector length ${vector.length} does not match vector(${CASE_EMBEDDING_DIM})`,
    );
  }
  return `[${vector.join(",")}]`;
}

let supportProbe: Promise<boolean> | null = null;

/**
 * Whether the vector path is usable: Postgres, with the embedding column the
 * migration only adds when the pgvector extension exists. Probed once and
 * cached; a negative answer is a warning and the JS path, never an error.
 */
export function caseVectorSearchReady(): Promise<boolean> {
  if (getDbBackend() !== "postgres") return Promise.resolve(false);
  if (!supportProbe) {
    supportProbe = query<{ ok: number | string }>(
      `SELECT 1 AS ok
         FROM information_schema.columns
        WHERE table_name = 'market_cases' AND column_name = 'embedding'`,
    )
      .then((rows) => {
        const ready = rows.length > 0;
        if (!ready) {
          log.warn(
            "market_cases has no embedding column (pgvector unavailable?) — case queries stay on the JS similarity path",
          );
        }
        return ready;
      })
      .catch((err) => {
        log.warn("pgvector probe failed — case queries stay on the JS similarity path", {
          error: err instanceof Error ? err.message : String(err),
        });
        return false;
      });
  }
  return supportProbe;
}

/** A runtime vector failure (dropped column, bad index) downgrades the path. */
export function markCaseVectorUnavailable(): void {
  supportProbe = Promise.resolve(false);
}

/** Tests re-probe rather than inherit another test's cached answer. */
export function resetCaseVectorProbeForTests(): void {
  supportProbe = null;
}

/**
 * Fill embeddings for rows indexed before the column existed.
 *
 * Embeddings derive from the FROZEN feature columns — a backfill re-encodes
 * what is already stored; it never recomputes features from candles, so a
 * backfilled row is bit-for-bit the case it always was.
 */
export async function backfillCaseEmbeddings(limit = 500): Promise<number> {
  if (!(await caseVectorSearchReady())) return 0;
  const rows = await query<{
    id: number | string;
    regime: string;
    trend: string;
    range_zone: string;
    pullback_depth: number | string;
    impulse_atr: number | string;
    volatility: number | string;
    session: string;
    structure_run: number | string;
  }>(
    `SELECT id, regime, trend, range_zone, pullback_depth, impulse_atr,
            volatility, session, structure_run
       FROM market_cases
      WHERE embedding IS NULL
      ORDER BY case_time DESC
      LIMIT ?`,
    [Math.max(1, Math.min(limit, 5_000))],
  ).catch(() => []);
  if (!rows.length) return 0;

  let updated = 0;
  for (const row of rows) {
    const fingerprint: CaseFingerprint = {
      regime: row.regime as Regime,
      trend: row.trend as Trend,
      rangeZone: row.range_zone as RangeZone,
      pullbackDepth: Number(row.pullback_depth),
      impulseAtr: Number(row.impulse_atr),
      volatility: Number(row.volatility),
      session: row.session as Session,
      structureRun: Number(row.structure_run),
    };
    const res = await execute(
      `UPDATE market_cases SET embedding = ?::vector WHERE id = ? AND embedding IS NULL`,
      [caseEmbeddingLiteral(fingerprint), row.id],
    ).catch((err) => {
      log.warn("embedding backfill write failed", {
        id: row.id,
        error: err instanceof Error ? err.message : String(err),
      });
      return { changes: 0, lastInsertId: 0 };
    });
    updated += res.changes;
  }
  if (updated > 0) log.info("backfilled case embeddings", { updated });
  return updated;
}
