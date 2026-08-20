/**
 * Gate records — the gate chain's verdicts as durable, timestamped rows.
 *
 * The agent loop is non-deterministic: the model CAN skip a tool call, a
 * prompt CAN be ignored. So the gates live OUTSIDE the loop as a hard check
 * before any write: every gate run records its verdict here, and the
 * canonical creator refuses a buy/sell write whose analysis has no fresh,
 * complete, non-vetoed record set. A missing or stale record is a named
 * rejection, never a warning.
 *
 * The required sequence mirrors the doctrine: news/economic events →
 * liquidity → supply & demand → price structure → final live-price
 * verification (G1, G2, G3, G4, G7). G5 was deleted with the backtest
 * apparatus; G6 (risk geometry) is recorded too and its veto blocks through
 * `chain_allowed`, while entry coherence is additionally re-checked at the
 * write itself.
 */
import { execute, query } from "@/lib/db";
import type { GateVerdict } from "@/lib/agent/gates/types";

export const MANDATORY_GATE_SEQUENCE = ["G1", "G2", "G3", "G4", "G7"] as const;

/** Records older than this cannot authorize a write — the market moved on. */
export const GATE_RECORD_MAX_AGE_MS = 10 * 60 * 1000;

export class GateRecordMissingError extends Error {
  constructor(detail: string) {
    super(`Gate record missing: ${detail}`);
    this.name = "GateRecordMissingError";
  }
}

export class GateRecordIncompleteError extends Error {
  constructor(detail: string) {
    super(`Gate record incomplete: ${detail}`);
    this.name = "GateRecordIncompleteError";
  }
}

export class GateRecordStaleError extends Error {
  constructor(detail: string) {
    super(`Gate record stale: ${detail}`);
    this.name = "GateRecordStaleError";
  }
}

export class GateRecordVetoError extends Error {
  constructor(
    public readonly gateId: string,
    public readonly gateName: string,
    public readonly reasonAr: string | null,
  ) {
    super(
      `Gate ${gateId} (${gateName}) vetoed this analysis${reasonAr ? `: ${reasonAr}` : ""}`,
    );
    this.name = "GateRecordVetoError";
  }
}

export interface RecordGateChainInput {
  userId: number;
  analysisId: string;
  symbol: string;
  verdicts: readonly GateVerdict[];
  /** The chain's own decision — the policy source of truth. */
  chainAllowed: boolean;
  now?: number;
}

/**
 * Persist one gate-chain run. Idempotent per (user, analysis, gate): a rerun
 * of the same analysis id overwrites its verdicts rather than duplicating.
 */
export async function recordGateChain(input: RecordGateChainInput): Promise<void> {
  const now = input.now ?? Date.now();
  for (const verdict of input.verdicts) {
    await execute(
      `INSERT INTO gate_records
         (user_id, analysis_id, symbol, gate_id, gate_name, status, reason_ar,
          evidence_json, chain_allowed, started_at, finished_at, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT (user_id, analysis_id, gate_id) DO UPDATE SET
         status = excluded.status,
         reason_ar = excluded.reason_ar,
         evidence_json = excluded.evidence_json,
         chain_allowed = excluded.chain_allowed,
         started_at = excluded.started_at,
         finished_at = excluded.finished_at,
         created_at = excluded.created_at`,
      [
        input.userId,
        input.analysisId,
        input.symbol.toUpperCase(),
        verdict.id,
        verdict.name,
        verdict.status,
        verdict.reasonAr ?? null,
        verdict.evidence ? JSON.stringify(verdict.evidence) : null,
        input.chainAllowed ? 1 : 0,
        verdict.startedAt,
        verdict.finishedAt,
        now,
      ],
    );
  }
}

interface GateRecordRow {
  gate_id: string;
  gate_name: string;
  status: string;
  reason_ar: string | null;
  chain_allowed: number | boolean;
  finished_at: number;
}

export interface GateRecordCheckInput {
  userId: number;
  analysisId: string | null | undefined;
  symbol: string;
  now?: number;
  maxAgeMs?: number;
}

/**
 * The hard check before any write. Throws a named error when the analysis
 * has no record, an incomplete sequence, a vetoed/blocked chain, or records
 * too old to still describe the market.
 */
export async function assertGateRecordsAllowCreation(
  input: GateRecordCheckInput,
): Promise<void> {
  const now = input.now ?? Date.now();
  const maxAgeMs = input.maxAgeMs ?? GATE_RECORD_MAX_AGE_MS;
  const analysisId = input.analysisId?.trim();
  if (!analysisId) {
    throw new GateRecordMissingError(
      "the recommendation names no analysis_id — run the analysis (gate chain) first; a write cannot authorize itself",
    );
  }
  const rows = await query<GateRecordRow>(
    `SELECT gate_id, gate_name, status, reason_ar, chain_allowed, finished_at
       FROM gate_records
      WHERE user_id = ? AND analysis_id = ? AND symbol = ?`,
    [input.userId, analysisId, input.symbol.toUpperCase()],
  );
  if (!rows.length) {
    throw new GateRecordMissingError(
      `no gate records exist for analysis ${analysisId} — the gate chain never ran for this analysis`,
    );
  }

  const byGate = new Map(rows.map((row) => [row.gate_id, row]));
  const missing = MANDATORY_GATE_SEQUENCE.filter((gate) => !byGate.has(gate));
  if (missing.length) {
    throw new GateRecordIncompleteError(
      `gates ${missing.join(", ")} have no recorded verdict for analysis ${analysisId}`,
    );
  }

  const veto = rows.find((row) => row.status === "veto");
  if (veto) {
    throw new GateRecordVetoError(veto.gate_id, veto.gate_name, veto.reason_ar);
  }

  // The chain's own allow decision covers required-unavailable policy (e.g. a
  // configured news provider that failed is blocking; none configured is not).
  const allowed = rows.every(
    (row) => row.chain_allowed === true || Number(row.chain_allowed) === 1,
  );
  if (!allowed) {
    throw new GateRecordIncompleteError(
      `the recorded gate chain for analysis ${analysisId} did not allow a recommendation`,
    );
  }

  const oldest = Math.min(...rows.map((row) => Number(row.finished_at)));
  if (now - oldest > maxAgeMs) {
    throw new GateRecordStaleError(
      `gate records for analysis ${analysisId} are ${Math.round((now - oldest) / 1000)}s old — older than the ${Math.round(maxAgeMs / 1000)}s freshness window; re-run the analysis`,
    );
  }
}

/** Read one analysis's recorded verdicts (operator surfaces, tests). */
export async function readGateRecords(
  userId: number,
  analysisId: string,
): Promise<
  { gateId: string; gateName: string; status: string; reasonAr: string | null; finishedAt: number }[]
> {
  const rows = await query<GateRecordRow>(
    `SELECT gate_id, gate_name, status, reason_ar, chain_allowed, finished_at
       FROM gate_records WHERE user_id = ? AND analysis_id = ? ORDER BY gate_id`,
    [userId, analysisId],
  );
  return rows.map((row) => ({
    gateId: row.gate_id,
    gateName: row.gate_name,
    status: row.status,
    reasonAr: row.reason_ar,
    finishedAt: Number(row.finished_at),
  }));
}
