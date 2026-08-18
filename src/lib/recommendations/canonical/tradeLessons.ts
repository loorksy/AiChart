import { execute, insertReturningId, query, queryOne } from "@/lib/db";
import { getCanonicalRecommendation } from "./repository";

export const DEFAULT_LESSON_MIN_SAMPLE_SIZE = 5;
export const DEFAULT_LESSON_MIN_CONFIDENCE = 0.65;

export type TradeLessonCandidateStatus = "candidate" | "validated" | "rejected";

export interface TradeLessonCandidate {
  id: number;
  userId: number;
  fingerprint: string;
  recommendationId: number;
  status: TradeLessonCandidateStatus;
  reason: string;
  evidenceEventIds: string[];
  strategyId: string;
  market: string;
  confidence: number;
  affectedSymbols: string[];
  sampleSize: number;
  createdAt: number;
  validatedAt?: number;
}

interface CandidateRow {
  id: number;
  user_id: number;
  fingerprint: string;
  recommendation_id: number;
  status: TradeLessonCandidateStatus;
  reason: string;
  evidence_event_ids_json: string;
  strategy_id: string;
  market: string;
  confidence: number;
  affected_symbols_json: string;
  sample_size: number;
  created_at: number;
  validated_at: number | null;
}

interface EvidenceRow {
  event_id: string;
  event_type: string;
  symbol: string;
  confidence: number;
  direction: string;
}

function strings(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function toCandidate(row: CandidateRow): TradeLessonCandidate {
  return {
    id: Number(row.id),
    userId: Number(row.user_id),
    fingerprint: row.fingerprint,
    recommendationId: Number(row.recommendation_id),
    status: row.status,
    reason: row.reason,
    evidenceEventIds: strings(row.evidence_event_ids_json),
    strategyId: row.strategy_id,
    market: row.market,
    confidence: Number(row.confidence),
    affectedSymbols: strings(row.affected_symbols_json),
    sampleSize: Number(row.sample_size),
    createdAt: Number(row.created_at),
    validatedAt: row.validated_at == null ? undefined : Number(row.validated_at),
  };
}

function lessonFingerprint(input: {
  strategyId: string;
  market: string;
  direction: string;
  result: "success" | "failure";
}): string {
  return [input.strategyId, input.market, input.direction, input.result]
    .map((part) => part.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "_"))
    .join(":");
}

export async function evaluateTradeLessonCandidate(
  userId: number,
  recommendationId: number,
  gates: { minSampleSize?: number; minConfidence?: number } = {},
): Promise<TradeLessonCandidate | null> {
  const recommendation = await getCanonicalRecommendation(userId, recommendationId);
  if (!recommendation) return null;
  const evidence = await query<EvidenceRow>(
    `SELECT e.event_id, e.event_type, r.symbol, r.confidence, COALESCE(r.direction, r.action) AS direction
       FROM recommendation_learning_events e
       JOIN recommendations r ON r.id = e.recommendation_id AND r.user_id = e.user_id
      WHERE e.user_id = ?
        AND COALESCE(r.market, 'forex') = ?
        AND e.event_type IN ('RecommendationSucceeded','RecommendationFailed')
      ORDER BY e.occurred_at ASC, e.event_id ASC`,
    [userId, recommendation.market],
  );
  const sameDirection = evidence.filter((row) => row.direction === recommendation.direction);
  const minSampleSize = gates.minSampleSize ?? DEFAULT_LESSON_MIN_SAMPLE_SIZE;
  if (sameDirection.length < minSampleSize) return null;

  const successes = sameDirection.filter((row) => row.event_type === "RecommendationSucceeded").length;
  const failures = sameDirection.length - successes;
  const result = successes >= failures ? "success" : "failure";
  const dominant = Math.max(successes, failures) / sameDirection.length;
  const sourceConfidence =
    sameDirection.reduce((sum, row) => sum + Number(row.confidence), 0) /
    sameDirection.length /
    100;
  const confidence = Math.round(dominant * sourceConfidence * 10_000) / 10_000;
  if (confidence < (gates.minConfidence ?? DEFAULT_LESSON_MIN_CONFIDENCE)) return null;

  const fingerprint = lessonFingerprint({
    strategyId: recommendation.strategyId,
    market: recommendation.market,
    direction: recommendation.direction,
    result,
  });
  const evidenceEventIds = sameDirection.map((row) => row.event_id).slice(-100);
  const affectedSymbols = [...new Set(sameDirection.map((row) => row.symbol))].sort();
  const reason =
    result === "success"
      ? `${recommendation.strategyId} produced a validated majority of successful ${recommendation.direction} recommendations.`
      : `${recommendation.strategyId} produced a validated majority of failed ${recommendation.direction} recommendations.`;
  const existing = await queryOne<CandidateRow>(
    "SELECT * FROM trade_lesson_candidates WHERE user_id = ? AND fingerprint = ?",
    [userId, fingerprint],
  );
  if (existing) {
    if (existing.status === "candidate") {
      await execute(
        `UPDATE trade_lesson_candidates
            SET recommendation_id = ?, reason = ?, evidence_event_ids_json = ?,
                confidence = ?, affected_symbols_json = ?, sample_size = ?
          WHERE id = ? AND user_id = ? AND status = 'candidate'`,
        [
          recommendationId,
          reason,
          JSON.stringify(evidenceEventIds),
          confidence,
          JSON.stringify(affectedSymbols),
          sameDirection.length,
          existing.id,
          userId,
        ],
      );
    }
    const refreshed = await queryOne<CandidateRow>(
      "SELECT * FROM trade_lesson_candidates WHERE id = ? AND user_id = ?",
      [existing.id, userId],
    );
    return refreshed ? toCandidate(refreshed) : toCandidate(existing);
  }

  const id = await insertReturningId(
    `INSERT INTO trade_lesson_candidates
      (user_id, fingerprint, recommendation_id, status, reason,
       evidence_event_ids_json, strategy_id, market, confidence,
       affected_symbols_json, sample_size, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      userId,
      fingerprint,
      recommendationId,
      "candidate",
      reason,
      JSON.stringify(evidenceEventIds),
      recommendation.strategyId,
      recommendation.market,
      confidence,
      JSON.stringify(affectedSymbols),
      sameDirection.length,
      Date.now(),
    ],
  );
  const created = await queryOne<CandidateRow>(
    "SELECT * FROM trade_lesson_candidates WHERE id = ? AND user_id = ?",
    [id, userId],
  );
  return created ? toCandidate(created) : null;
}

export async function validateTradeLessonCandidate(
  userId: number,
  candidateId: number,
  gates: { minSampleSize?: number; minConfidence?: number } = {},
): Promise<TradeLessonCandidate | null> {
  const candidate = await queryOne<CandidateRow>(
    "SELECT * FROM trade_lesson_candidates WHERE id = ? AND user_id = ?",
    [candidateId, userId],
  );
  if (!candidate) return null;
  if (
    Number(candidate.sample_size) < (gates.minSampleSize ?? DEFAULT_LESSON_MIN_SAMPLE_SIZE) ||
    Number(candidate.confidence) < (gates.minConfidence ?? DEFAULT_LESSON_MIN_CONFIDENCE)
  ) {
    return toCandidate(candidate);
  }
  await execute(
    `UPDATE trade_lesson_candidates SET status = 'validated', validated_at = ?
      WHERE id = ? AND user_id = ? AND status = 'candidate'`,
    [Date.now(), candidateId, userId],
  );
  const updated = await queryOne<CandidateRow>(
    "SELECT * FROM trade_lesson_candidates WHERE id = ? AND user_id = ?",
    [candidateId, userId],
  );
  return updated ? toCandidate(updated) : null;
}

export async function listValidatedTradeLessons(
  userId: number,
  options: { strategyId?: string; market?: string; limit?: number } = {},
): Promise<TradeLessonCandidate[]> {
  const clauses = ["user_id = ?", "status = 'validated'"];
  const params: unknown[] = [userId];
  if (options.strategyId) {
    clauses.push("strategy_id = ?");
    params.push(options.strategyId);
  }
  if (options.market) {
    clauses.push("market = ?");
    params.push(options.market);
  }
  params.push(Math.max(1, Math.min(options.limit ?? 20, 100)));
  const rows = await query<CandidateRow>(
    `SELECT * FROM trade_lesson_candidates WHERE ${clauses.join(" AND ")}
      ORDER BY confidence DESC, sample_size DESC, id DESC LIMIT ?`,
    params,
  );
  return rows.map(toCandidate);
}
