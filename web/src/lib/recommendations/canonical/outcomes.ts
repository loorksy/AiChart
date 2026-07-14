import { execute, insertReturningId, query, queryOne } from "@/lib/db";
import { getCanonicalRecommendation } from "./repository";
import {
  RecommendationLifecycleError,
  type RecommendationLearningEvent,
  type RecommendationLearningEventType,
  type RecommendationOutcome,
  type RecordRecommendationOutcomeInput,
} from "./types";

interface OutcomeRow {
  id: number;
  recommendation_id: number;
  user_id: number;
  outcome_type: RecommendationOutcome["type"];
  target_index: number | null;
  price: number | null;
  r_multiple: number | null;
  pnl: number | null;
  holding_ms: number | null;
  mae: number | null;
  mfe: number | null;
  spread_cost: number | null;
  slippage: number | null;
  commission: number | null;
  risk_used: number | null;
  occurred_at: number;
  source: string;
  evidence_json: string;
  dedupe_key: string;
}

interface LearningRow {
  event_id: string;
  recommendation_id: number;
  user_id: number;
  event_type: RecommendationLearningEventType;
  occurred_at: number;
  source_outcome_id: number | null;
  payload_json: string;
  evidence_json: string;
}

function object(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function optional(value: number | null): number | undefined {
  return value == null ? undefined : Number(value);
}

function toOutcome(row: OutcomeRow): RecommendationOutcome {
  return {
    id: Number(row.id),
    recommendationId: Number(row.recommendation_id),
    userId: Number(row.user_id),
    type: row.outcome_type,
    targetIndex: optional(row.target_index) as 1 | 2 | 3 | undefined,
    price: optional(row.price),
    rMultiple: optional(row.r_multiple),
    pnl: optional(row.pnl),
    holdingMs: optional(row.holding_ms),
    mae: optional(row.mae),
    mfe: optional(row.mfe),
    spreadCost: optional(row.spread_cost),
    slippage: optional(row.slippage),
    commission: optional(row.commission),
    riskUsed: optional(row.risk_used),
    occurredAt: Number(row.occurred_at),
    source: row.source,
    evidence: object(row.evidence_json),
  };
}

function learningTypes(type: RecommendationOutcome["type"]): RecommendationLearningEventType[] {
  switch (type) {
    case "TP1":
    case "TP2":
      return ["PartialTargetHit"];
    case "TP3":
      return ["FinalTargetHit", "RecommendationSucceeded"];
    case "SL":
      return ["RecommendationFailed"];
    case "BreakEven":
      return ["BreakEvenReached"];
    case "Trailing":
      return ["TrailingActivated"];
    case "Expired":
      return ["RecommendationExpired"];
    case "Cancelled":
      return ["RecommendationCancelled"];
    case "Invalidated":
      return ["RecommendationInvalidated"];
    case "ManualClose":
      return [];
  }
}

async function appendLearningEvents(outcome: RecommendationOutcome): Promise<void> {
  for (const eventType of learningTypes(outcome.type)) {
    const eventId = `rec:${outcome.recommendationId}:outcome:${outcome.id}:${eventType}`;
    await execute(
      `INSERT INTO recommendation_learning_events
        (event_id, recommendation_id, user_id, event_type, occurred_at,
         source_outcome_id, payload_json, evidence_json)
       VALUES (?,?,?,?,?,?,?,?) ON CONFLICT (event_id) DO NOTHING`,
      [
        eventId,
        outcome.recommendationId,
        outcome.userId,
        eventType,
        outcome.occurredAt,
        outcome.id,
        JSON.stringify({
          outcomeType: outcome.type,
          targetIndex: outcome.targetIndex,
          rMultiple: outcome.rMultiple,
          pnl: outcome.pnl,
        }),
        JSON.stringify(outcome.evidence),
      ],
    );
  }
}

async function ensureDerivedLearning(outcome: RecommendationOutcome): Promise<void> {
  await appendLearningEvents(outcome);
  const { evaluateTradeLessonCandidate } = await import("./tradeLessons");
  await evaluateTradeLessonCandidate(
    outcome.userId,
    outcome.recommendationId,
  ).catch(() => null);
}

export async function recordRecommendationOutcome(
  input: RecordRecommendationOutcomeInput,
): Promise<RecommendationOutcome> {
  const recommendation = await getCanonicalRecommendation(input.userId, input.recommendationId);
  if (!recommendation) {
    throw new RecommendationLifecycleError(
      "RECOMMENDATION_NOT_FOUND",
      "Recommendation does not exist for this tenant",
    );
  }
  const dedupeKey =
    input.dedupeKey ??
    `${input.type}:${input.targetIndex ?? 0}:${input.occurredAt ?? "unspecified"}`;
  const existing = await queryOne<OutcomeRow>(
    `SELECT * FROM recommendation_outcomes
      WHERE recommendation_id = ? AND user_id = ? AND dedupe_key = ?`,
    [input.recommendationId, input.userId, dedupeKey],
  );
  if (existing) {
    const outcome = toOutcome(existing);
    await ensureDerivedLearning(outcome);
    return outcome;
  }

  const occurredAt = input.occurredAt ?? Date.now();
  let id: number;
  try {
    id = await insertReturningId(
      `INSERT INTO recommendation_outcomes
        (recommendation_id, user_id, outcome_type, target_index, price, r_multiple,
         pnl, holding_ms, mae, mfe, spread_cost, slippage, commission, risk_used,
         occurred_at, source, evidence_json, dedupe_key)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        input.recommendationId,
        input.userId,
        input.type,
        input.targetIndex ?? null,
        input.price ?? null,
        input.rMultiple ?? null,
        input.pnl ?? null,
        input.holdingMs ?? null,
        input.mae ?? null,
        input.mfe ?? null,
        input.spreadCost ?? null,
        input.slippage ?? null,
        input.commission ?? null,
        input.riskUsed ?? null,
        occurredAt,
        input.source,
        JSON.stringify(input.evidence ?? {}),
        dedupeKey,
      ],
    );
  } catch (error) {
    const concurrent = await queryOne<OutcomeRow>(
      `SELECT * FROM recommendation_outcomes
        WHERE recommendation_id = ? AND user_id = ? AND dedupe_key = ?`,
      [input.recommendationId, input.userId, dedupeKey],
    );
    if (concurrent) {
      const outcome = toOutcome(concurrent);
      await ensureDerivedLearning(outcome);
      return outcome;
    }
    throw error;
  }
  const stored = await queryOne<OutcomeRow>(
    "SELECT * FROM recommendation_outcomes WHERE id = ? AND user_id = ?",
    [id, input.userId],
  );
  if (!stored) {
    throw new RecommendationLifecycleError(
      "RECOMMENDATION_NOT_FOUND",
      "Outcome was not readable after append",
    );
  }
  const outcome = toOutcome(stored);
  await ensureDerivedLearning(outcome);
  return outcome;
}

export async function listRecommendationOutcomes(
  userId: number,
  recommendationId: number,
): Promise<RecommendationOutcome[]> {
  const rows = await query<OutcomeRow>(
    `SELECT * FROM recommendation_outcomes
      WHERE recommendation_id = ? AND user_id = ? ORDER BY occurred_at ASC, id ASC`,
    [recommendationId, userId],
  );
  return rows.map(toOutcome);
}

export async function listRecommendationLearningEvents(
  userId: number,
  recommendationId?: number,
): Promise<RecommendationLearningEvent[]> {
  const rows = await query<LearningRow>(
    recommendationId == null
      ? `SELECT * FROM recommendation_learning_events
          WHERE user_id = ? ORDER BY occurred_at ASC, event_id ASC`
      : `SELECT * FROM recommendation_learning_events
          WHERE user_id = ? AND recommendation_id = ?
          ORDER BY occurred_at ASC, event_id ASC`,
    recommendationId == null ? [userId] : [userId, recommendationId],
  );
  return rows.map((row) => ({
    eventId: row.event_id,
    recommendationId: Number(row.recommendation_id),
    userId: Number(row.user_id),
    eventType: row.event_type,
    occurredAt: Number(row.occurred_at),
    sourceOutcomeId: optional(row.source_outcome_id),
    payload: object(row.payload_json),
    evidence: object(row.evidence_json),
  }));
}
