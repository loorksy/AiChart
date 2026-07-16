/**
 * Persistent Deep Analysis run records — supports idempotency, stale discard,
 * tenant recheck, and restart reconcile.
 */
import { execute, query, queryOne } from "@/lib/db";

export type DeepAnalysisRunStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "discarded"
  | "cancelled";

export type DeepAnalysisInternalProgress =
  | "job_created"
  | "polling"
  | "validation_running"
  | "verifying_history"
  | "almost_ready"
  | "ready"
  | "failed";

export interface DeepAnalysisRun {
  analysisId: string;
  userId: number;
  sessionId: string | null;
  chatId: string | null;
  messageId: string | null;
  recommendationId: number | null;
  recommendationRef: string | null;
  symbol: string;
  interval: string;
  generation: number;
  researchJobId: string | null;
  validationJobId: string | null;
  status: DeepAnalysisRunStatus;
  internalProgress: DeepAnalysisInternalProgress;
  uxUpdateCount: number;
  allowReason: string | null;
  failureReason: string | null;
  strategyFingerprint: string | null;
  resultProjectionJson: string | null;
  locale: "ar" | "en";
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
}

interface Row {
  analysis_id: string;
  user_id: number;
  session_id: string | null;
  chat_id: string | null;
  message_id: string | null;
  recommendation_id: number | null;
  recommendation_ref: string | null;
  symbol: string;
  interval: string;
  generation: number;
  research_job_id: string | null;
  validation_job_id: string | null;
  status: string;
  internal_progress: string;
  ux_update_count: number;
  allow_reason: string | null;
  failure_reason: string | null;
  strategy_fingerprint: string | null;
  result_projection_json: string | null;
  locale: string;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
}

function toRun(row: Row): DeepAnalysisRun {
  return {
    analysisId: row.analysis_id,
    userId: Number(row.user_id),
    sessionId: row.session_id,
    chatId: row.chat_id,
    messageId: row.message_id,
    recommendationId:
      row.recommendation_id == null ? null : Number(row.recommendation_id),
    recommendationRef: row.recommendation_ref,
    symbol: row.symbol,
    interval: row.interval,
    generation: Number(row.generation),
    researchJobId: row.research_job_id,
    validationJobId: row.validation_job_id,
    status: row.status as DeepAnalysisRunStatus,
    internalProgress: row.internal_progress as DeepAnalysisInternalProgress,
    uxUpdateCount: Number(row.ux_update_count),
    allowReason: row.allow_reason,
    failureReason: row.failure_reason,
    strategyFingerprint: row.strategy_fingerprint,
    resultProjectionJson: row.result_projection_json,
    locale: row.locale === "en" ? "en" : "ar",
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    completedAt: row.completed_at == null ? null : Number(row.completed_at),
  };
}

export async function createDeepAnalysisRun(input: {
  analysisId: string;
  userId: number;
  sessionId?: string | null;
  chatId?: string | null;
  messageId?: string | null;
  recommendationId?: number | null;
  recommendationRef?: string | null;
  symbol: string;
  interval: string;
  generation: number;
  allowReason?: string | null;
  strategyFingerprint?: string | null;
  locale?: "ar" | "en";
  researchJobId?: string | null;
}): Promise<DeepAnalysisRun> {
  const now = Date.now();
  await execute(
    `INSERT INTO deep_analysis_runs
      (analysis_id, user_id, session_id, chat_id, message_id, recommendation_id,
       recommendation_ref, symbol, interval, generation, research_job_id,
       validation_job_id, status, internal_progress, ux_update_count,
       allow_reason, failure_reason, strategy_fingerprint, result_projection_json,
       locale, created_at, updated_at, completed_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT (analysis_id) DO NOTHING`,
    [
      input.analysisId,
      input.userId,
      input.sessionId ?? null,
      input.chatId ?? null,
      input.messageId ?? null,
      input.recommendationId ?? null,
      input.recommendationRef ?? null,
      input.symbol.toUpperCase(),
      input.interval,
      input.generation,
      input.researchJobId ?? null,
      null,
      "pending",
      "job_created",
      0,
      input.allowReason ?? null,
      null,
      input.strategyFingerprint ?? null,
      null,
      input.locale ?? "ar",
      now,
      now,
      null,
    ],
  );
  const row = await queryOne<Row>(
    "SELECT * FROM deep_analysis_runs WHERE analysis_id = ? AND user_id = ?",
    [input.analysisId, input.userId],
  );
  if (!row) throw new Error("deep_analysis_run_create_failed");
  return toRun(row);
}

export async function getDeepAnalysisRun(
  userId: number,
  analysisId: string,
): Promise<DeepAnalysisRun | null> {
  const row = await queryOne<Row>(
    "SELECT * FROM deep_analysis_runs WHERE analysis_id = ? AND user_id = ?",
    [analysisId, userId],
  );
  return row ? toRun(row) : null;
}

export async function getLatestDeepAnalysisForSessionSymbol(input: {
  userId: number;
  sessionId: string;
  symbol: string;
}): Promise<DeepAnalysisRun | null> {
  const row = await queryOne<Row>(
    `SELECT * FROM deep_analysis_runs
      WHERE user_id = ? AND session_id = ? AND symbol = ?
      ORDER BY generation DESC, created_at DESC LIMIT 1`,
    [input.userId, input.sessionId, input.symbol.toUpperCase()],
  );
  return row ? toRun(row) : null;
}

export async function nextDeepAnalysisGeneration(input: {
  userId: number;
  sessionId: string;
  symbol: string;
}): Promise<number> {
  const row = await queryOne<{ g: number | null }>(
    `SELECT MAX(generation) AS g FROM deep_analysis_runs
      WHERE user_id = ? AND session_id = ? AND symbol = ?`,
    [input.userId, input.sessionId, input.symbol.toUpperCase()],
  );
  return (row?.g ?? 0) + 1;
}

export async function updateDeepAnalysisRun(
  userId: number,
  analysisId: string,
  patch: Partial<{
    status: DeepAnalysisRunStatus;
    internalProgress: DeepAnalysisInternalProgress;
    researchJobId: string | null;
    validationJobId: string | null;
    uxUpdateCount: number;
    failureReason: string | null;
    resultProjectionJson: string | null;
    completedAt: number | null;
    messageId: string | null;
    recommendationId: number | null;
    recommendationRef: string | null;
  }>,
): Promise<DeepAnalysisRun | null> {
  const existing = await getDeepAnalysisRun(userId, analysisId);
  if (!existing) return null;
  const now = Date.now();
  await execute(
    `UPDATE deep_analysis_runs SET
      status = ?, internal_progress = ?, research_job_id = ?, validation_job_id = ?,
      ux_update_count = ?, failure_reason = ?, result_projection_json = ?,
      completed_at = ?, message_id = ?, recommendation_id = ?, recommendation_ref = ?,
      updated_at = ?
     WHERE analysis_id = ? AND user_id = ?`,
    [
      patch.status ?? existing.status,
      patch.internalProgress ?? existing.internalProgress,
      patch.researchJobId === undefined
        ? existing.researchJobId
        : patch.researchJobId,
      patch.validationJobId === undefined
        ? existing.validationJobId
        : patch.validationJobId,
      patch.uxUpdateCount ?? existing.uxUpdateCount,
      patch.failureReason === undefined
        ? existing.failureReason
        : patch.failureReason,
      patch.resultProjectionJson === undefined
        ? existing.resultProjectionJson
        : patch.resultProjectionJson,
      patch.completedAt === undefined ? existing.completedAt : patch.completedAt,
      patch.messageId === undefined ? existing.messageId : patch.messageId,
      patch.recommendationId === undefined
        ? existing.recommendationId
        : patch.recommendationId,
      patch.recommendationRef === undefined
        ? existing.recommendationRef
        : patch.recommendationRef,
      now,
      analysisId,
      userId,
    ],
  );
  return getDeepAnalysisRun(userId, analysisId);
}

export async function listPendingDeepAnalysisRuns(
  limit = 50,
): Promise<DeepAnalysisRun[]> {
  const rows = await query<Row>(
    `SELECT * FROM deep_analysis_runs
      WHERE status IN ('pending','running')
      ORDER BY updated_at ASC LIMIT ?`,
    [Math.max(1, Math.min(limit, 200))],
  );
  return rows.map(toRun);
}

/** Idempotent create helper used by enqueue — returns existing if same key. */
export async function findActiveDeepAnalysisByFingerprint(input: {
  userId: number;
  sessionId: string;
  symbol: string;
  fingerprint: string;
}): Promise<DeepAnalysisRun | null> {
  const row = await queryOne<Row>(
    `SELECT * FROM deep_analysis_runs
      WHERE user_id = ? AND session_id = ? AND symbol = ?
        AND strategy_fingerprint = ?
        AND status IN ('pending','running')
      ORDER BY generation DESC LIMIT 1`,
    [
      input.userId,
      input.sessionId,
      input.symbol.toUpperCase(),
      input.fingerprint,
    ],
  );
  return row ? toRun(row) : null;
}
