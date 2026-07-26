import { getDbBackend, query, queryOne, transaction } from "@/lib/db";
import { createLogger } from "@/lib/logger";
import { FEATURES } from "@/lib/agent/featureFlags";
import { assertRecommendationTransition, initialRecommendationStatus } from "./stateMachine";
import { applyRecommendationRevision } from "./revisions";
import {
  RecommendationLifecycleError,
  type CanonicalRecommendation,
  type CreateCanonicalRecommendationInput,
  type RecommendationHistoryEntry,
  type RecommendationStatus,
  type RecommendationTransition,
  type TransitionRecommendationInput,
} from "./types";

const log = createLogger("recommendations:canonical");

interface RecommendationRow {
  id: number;
  user_id: number;
  analysis_id: string | null;
  session_id: string | null;
  chat_id: string | null;
  symbol: string;
  market: string | null;
  timeframe: string | null;
  action: string;
  direction: string | null;
  entry: number | null;
  stop_loss: number | null;
  take_profit: number | null;
  targets_json: string | null;
  risk_json: string | null;
  confidence: number;
  backtested_confidence: number | null;
  confidence_low: number | null;
  confidence_high: number | null;
  backtest_id: number | null;
  market_regime: string | null;
  strategy_id: string | null;
  strategy_version: string | null;
  created_at: string | number;
  expires_at: number | null;
  status: string | null;
  status_reason: string | null;
  source: string | null;
  engine_version: string | null;
  entry_type: string | null;
  legacy_tracking_id: string | null;
}

interface TransitionRow {
  id: number;
  recommendation_id: number;
  user_id: number;
  from_status: string | null;
  to_status: string;
  occurred_at: number;
  trigger_name: string;
  actor: string;
  source: string;
  reason: string;
  metadata_json: string;
}

interface HistoryRow {
  id: number;
  recommendation_id: number;
  user_id: number;
  kind: RecommendationHistoryEntry["kind"];
  occurred_at: number;
  actor: string;
  source: string;
  payload_json: string;
}

function jsonObject(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const value: unknown = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function numberArray(raw: string | null, fallback?: number | null): number[] {
  if (raw) {
    try {
      const value: unknown = JSON.parse(raw);
      if (Array.isArray(value)) {
        return value.filter((item): item is number => typeof item === "number" && Number.isFinite(item));
      }
    } catch {
      // Legacy rows use take_profit below.
    }
  }
  return fallback == null ? [] : [Number(fallback)];
}

function epoch(value: string | number): number {
  if (typeof value === "number") return value;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function clampConfidence(value: number | undefined): number {
  return Math.max(0, Math.min(100, Math.round(value ?? 0)));
}

function toCanonical(row: RecommendationRow): CanonicalRecommendation {
  const action = row.direction ?? row.action;
  return {
    recommendationId: Number(row.id),
    analysisId: row.analysis_id ?? undefined,
    sessionId: row.session_id ?? undefined,
    chatId: row.chat_id ?? undefined,
    userId: Number(row.user_id),
    symbol: row.symbol,
    market: row.market ?? "forex",
    timeframe: row.timeframe ?? "unspecified",
    direction: action === "buy" || action === "sell" ? action : "wait",
    entry: row.entry == null ? undefined : Number(row.entry),
    stopLoss: row.stop_loss == null ? undefined : Number(row.stop_loss),
    targets: numberArray(row.targets_json, row.take_profit),
    risk: jsonObject(row.risk_json),
    confidence: Number(row.confidence),
    backtestedConfidence:
      row.backtested_confidence == null
        ? undefined
        : Number(row.backtested_confidence),
    confidenceLow:
      row.confidence_low == null ? undefined : Number(row.confidence_low),
    confidenceHigh:
      row.confidence_high == null ? undefined : Number(row.confidence_high),
    backtestId: row.backtest_id == null ? undefined : Number(row.backtest_id),
    marketRegime: row.market_regime ?? undefined,
    strategyId: row.strategy_id ?? "unspecified",
    strategyVersion: row.strategy_version ?? "1",
    createdAt: epoch(row.created_at),
    expiresAt:
      row.expires_at == null
        ? epoch(row.created_at) + 4 * 60 * 60 * 1000
        : Number(row.expires_at),
    status: (row.status ?? "draft") as RecommendationStatus,
    statusReason: row.status_reason ?? "",
    source: row.source ?? "web",
    engineVersion: row.engine_version ?? "legacy",
    entryType: row.entry_type ?? undefined,
    legacyTrackingId: row.legacy_tracking_id ?? undefined,
  };
}

function toTransition(row: TransitionRow): RecommendationTransition {
  return {
    id: Number(row.id),
    recommendationId: Number(row.recommendation_id),
    userId: Number(row.user_id),
    fromStatus: (row.from_status ?? undefined) as RecommendationStatus | undefined,
    toStatus: row.to_status as RecommendationStatus,
    occurredAt: Number(row.occurred_at),
    trigger: row.trigger_name,
    actor: row.actor,
    source: row.source,
    reason: row.reason,
    metadata: jsonObject(row.metadata_json),
  };
}

export async function createCanonicalRecommendation(
  input: CreateCanonicalRecommendationInput,
): Promise<CanonicalRecommendation> {
  const direction = input.direction;
  const targets = (input.targets ?? []).filter(Number.isFinite).slice(0, 3);
  const status =
    input.status ??
    initialRecommendationStatus({
      direction,
      entry: input.entry,
      stopLoss: input.stopLoss,
      targets,
    });
  if (status !== "draft" && status !== "active") {
    throw new RecommendationLifecycleError(
      "RECOMMENDATION_INVALID_INPUT",
      "Recommendations must be created as draft or active and then use the state machine",
    );
  }
  const now = input.createdAt ?? Date.now();
  const expiresAt = input.expiresAt ?? now + 4 * 60 * 60 * 1000;
  const createdAtExpression =
    getDbBackend() === "postgres"
      ? "to_timestamp(? / 1000.0)"
      : "datetime(? / 1000, 'unixepoch')";

  const recommendationId = await transaction(async (db) => {
    const id = await db.insertReturningId(
      `INSERT INTO recommendations
        (user_id, analysis_id, session_id, chat_id, symbol, market, timeframe,
         action, direction, entry, stop_loss, take_profit, targets_json, risk_json,
         confidence, backtested_confidence, confidence_low, confidence_high,
         backtest_id, market_regime, strategy_id, strategy_version, expires_at, status, status_reason,
         source, engine_version, entry_type, legacy_tracking_id, rationale, factors,
         chart_drawings_json, pattern_name, analysis_tier, context_json,
         statistical_support, updated_at, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,${createdAtExpression})`,
      [
        input.userId,
        input.analysisId ?? null,
        input.sessionId ?? null,
        input.chatId ?? null,
        input.symbol.toUpperCase(),
        input.market ?? "forex",
        input.timeframe ?? "unspecified",
        direction,
        direction,
        input.entry ?? null,
        input.stopLoss ?? null,
        targets[0] ?? null,
        JSON.stringify(targets),
        JSON.stringify(input.risk ?? {}),
        clampConfidence(input.confidence),
        input.backtestedConfidence ?? null,
        input.confidenceLow ?? null,
        input.confidenceHigh ?? null,
        input.backtestId ?? null,
        input.marketRegime ?? null,
        input.strategyId ?? "unspecified",
        input.strategyVersion ?? "1",
        expiresAt,
        status,
        input.statusReason ?? "created",
        input.source ?? "web",
        input.engineVersion ?? "aichart-phase4-v1",
        input.entryType ?? null,
        input.legacyTrackingId ?? null,
        input.rationale ?? null,
        input.factors?.length ? JSON.stringify(input.factors) : null,
        input.chartDrawingsJson ?? null,
        input.patternName ?? null,
        input.analysisTier ?? null,
        input.contextJson ?? null,
        input.statisticalSupport ?? null,
        now,
        now,
      ],
    );
    const publicSnapshot = {
      analysisId: input.analysisId,
      sessionId: input.sessionId,
      chatId: input.chatId,
      symbol: input.symbol.toUpperCase(),
      market: input.market ?? "forex",
      timeframe: input.timeframe ?? "unspecified",
      direction,
      entry: input.entry ?? undefined,
      stopLoss: input.stopLoss ?? undefined,
      backtestedConfidence: input.backtestedConfidence,
      confidenceLow: input.confidenceLow,
      confidenceHigh: input.confidenceHigh,
      backtestId: input.backtestId,
      marketRegime: input.marketRegime,
      targets,
      confidence: clampConfidence(input.confidence),
      strategyId: input.strategyId ?? "unspecified",
      strategyVersion: input.strategyVersion ?? "1",
      expiresAt,
      status,
      source: input.source ?? "web",
      engineVersion: input.engineVersion ?? "aichart-phase4-v1",
      chartDrawingsJson: input.chartDrawingsJson,
    };
    await db.execute(
      `INSERT INTO recommendation_history
        (recommendation_id, user_id, kind, occurred_at, actor, source, payload_json)
       VALUES (?,?,?,?,?,?,?)`,
      [id, input.userId, "created", now, "system", input.source ?? "web", JSON.stringify(publicSnapshot)],
    );
    await db.execute(
      `INSERT INTO recommendation_transitions
        (recommendation_id, user_id, from_status, to_status, occurred_at,
         trigger_name, actor, source, reason, metadata_json)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [
        id,
        input.userId,
        null,
        status,
        now,
        "creation",
        "system",
        input.source ?? "web",
        input.statusReason ?? "created",
        "{}",
      ],
    );
    return id;
  });

  /**
   * Seed revision 1.
   *
   * Every recommendation needs an effective revision from birth: a later update
   * has to have something to supersede, and the compare-and-swap on execution
   * has to have a number to compare against. Without it a recommendation can be
   * neither revised nor auto-executed.
   *
   * Legacy `wait` rows are skipped deliberately — they carry no plan to revise
   * and must never become executable.
   *
   * Best-effort: the recommendation already exists and the operator has already
   * been shown it, so a revision failure must not delete their answer. It costs
   * auto-execution eligibility, which is the safe direction to fail in.
   */
  // Gated by REC_REVISIONS_V1: turning the phase off stops SEEDING new
  // revisions. It never stops reading existing ones — rollback must not make
  // stored history unreadable.
  if (FEATURES.recRevisionsV1() && (direction === "buy" || direction === "sell")) {
    const seed = input.initialRevision;
    await applyRecommendationRevision({
      userId: input.userId,
      recommendationId,
      timestamp: now,
      revision: {
        direction,
        planType: input.planType ?? null,
        executionState: input.executionState ?? null,
        entry: input.entry ?? null,
        entryLow: seed?.entryLow ?? null,
        entryHigh: seed?.entryHigh ?? null,
        stopLoss: input.stopLoss ?? null,
        targets,
        activationCondition: seed?.activationCondition ?? null,
        invalidationRule: seed?.invalidationRule ?? null,
        alternativeScenario: seed?.alternativeScenario ?? null,
        validityCandles: seed?.validityCandles ?? null,
        expiresAt,
        reason: "initial recommendation",
        source: "agent",
        evidence: seed?.evidence ?? null,
        decisionTrace: seed?.decisionTrace ?? null,
      },
    }).catch((err) => {
      log.warn("failed to seed revision 1", {
        recommendationId,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }

  const stored = await getCanonicalRecommendation(input.userId, recommendationId);
  if (!stored) {
    throw new RecommendationLifecycleError(
      "RECOMMENDATION_NOT_FOUND",
      "Canonical recommendation was not readable after creation",
    );
  }
  return stored;
}

export async function getCanonicalRecommendation(
  userId: number,
  recommendationId: number,
): Promise<CanonicalRecommendation | null> {
  const row = await queryOne<RecommendationRow>(
    "SELECT * FROM recommendations WHERE id = ? AND user_id = ?",
    [recommendationId, userId],
  );
  return row ? toCanonical(row) : null;
}

export async function getCanonicalRecommendationByReference(
  userId: number,
  reference: string | number,
): Promise<CanonicalRecommendation | null> {
  const asNumber = Number(reference);
  const row = await queryOne<RecommendationRow>(
    Number.isInteger(asNumber) && asNumber > 0
      ? "SELECT * FROM recommendations WHERE user_id = ? AND (id = ? OR legacy_tracking_id = ?)"
      : "SELECT * FROM recommendations WHERE user_id = ? AND legacy_tracking_id = ?",
    Number.isInteger(asNumber) && asNumber > 0
      ? [userId, asNumber, String(reference)]
      : [userId, String(reference)],
  );
  return row ? toCanonical(row) : null;
}

export async function listCanonicalRecommendations(
  userId: number,
  options: { limit?: number; activeOnly?: boolean } = {},
): Promise<CanonicalRecommendation[]> {
  const limit = Math.max(1, Math.min(options.limit ?? 500, 5000));
  const terminal = "'tp_hit','sl_hit','expired','cancelled','invalidated','closed'";
  const rows = await query<RecommendationRow>(
    options.activeOnly
      ? `SELECT * FROM recommendations WHERE user_id = ? AND status NOT IN (${terminal}) ORDER BY created_at DESC, id DESC LIMIT ?`
      : "SELECT * FROM recommendations WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?",
    [userId, limit],
  );
  return rows.map(toCanonical);
}

export async function listAllActiveCanonicalRecommendations(
  limit = 500,
): Promise<CanonicalRecommendation[]> {
  const rows = await query<RecommendationRow>(
    `SELECT * FROM recommendations
      WHERE status NOT IN ('tp_hit','sl_hit','expired','cancelled','invalidated','closed')
      ORDER BY created_at DESC, id DESC LIMIT ?`,
    [Math.max(1, Math.min(limit, 5000))],
  );
  return rows.map(toCanonical);
}

export async function transitionRecommendation(
  input: TransitionRecommendationInput,
): Promise<CanonicalRecommendation> {
  const timestamp = input.timestamp ?? Date.now();
  await transaction(async (db) => {
    const rows = await db.query<RecommendationRow>(
      "SELECT * FROM recommendations WHERE id = ? AND user_id = ?",
      [input.recommendationId, input.userId],
    );
    const current = rows[0];
    if (!current) {
      throw new RecommendationLifecycleError(
        "RECOMMENDATION_NOT_FOUND",
        "Recommendation does not exist for this tenant",
      );
    }
    const from = (current.status ?? "draft") as RecommendationStatus;
    assertRecommendationTransition(from, input.toStatus);
    const updated = await db.execute(
      `UPDATE recommendations
          SET status = ?, status_reason = ?, updated_at = ?
        WHERE id = ? AND user_id = ? AND status = ?`,
      [input.toStatus, input.reason, timestamp, input.recommendationId, input.userId, from],
    );
    if (updated.changes !== 1) {
      throw new RecommendationLifecycleError(
        "RECOMMENDATION_ILLEGAL_TRANSITION",
        "Recommendation changed concurrently; transition was not recorded",
      );
    }
    await db.execute(
      `INSERT INTO recommendation_transitions
        (recommendation_id, user_id, from_status, to_status, occurred_at,
         trigger_name, actor, source, reason, metadata_json)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [
        input.recommendationId,
        input.userId,
        from,
        input.toStatus,
        timestamp,
        input.trigger,
        input.actor,
        input.source,
        input.reason,
        JSON.stringify(input.metadata ?? {}),
      ],
    );
  });
  const updated = await getCanonicalRecommendation(input.userId, input.recommendationId);
  if (!updated) {
    throw new RecommendationLifecycleError(
      "RECOMMENDATION_NOT_FOUND",
      "Recommendation disappeared after transition",
    );
  }
  return updated;
}

export async function listRecommendationTransitions(
  userId: number,
  recommendationId: number,
): Promise<RecommendationTransition[]> {
  const rows = await query<TransitionRow>(
    `SELECT * FROM recommendation_transitions
      WHERE recommendation_id = ? AND user_id = ?
      ORDER BY occurred_at ASC, id ASC`,
    [recommendationId, userId],
  );
  return rows.map(toTransition);
}

export async function appendRecommendationHistory(input: {
  userId: number;
  recommendationId: number;
  kind: RecommendationHistoryEntry["kind"];
  occurredAt?: number;
  actor: string;
  source: string;
  payload: Record<string, unknown>;
}): Promise<void> {
  const owner = await getCanonicalRecommendation(input.userId, input.recommendationId);
  if (!owner) {
    throw new RecommendationLifecycleError(
      "RECOMMENDATION_NOT_FOUND",
      "Recommendation does not exist for this tenant",
    );
  }
  await transaction(async (db) => {
    await db.execute(
      `INSERT INTO recommendation_history
        (recommendation_id, user_id, kind, occurred_at, actor, source, payload_json)
       VALUES (?,?,?,?,?,?,?)`,
      [
        input.recommendationId,
        input.userId,
        input.kind,
        input.occurredAt ?? Date.now(),
        input.actor,
        input.source,
        JSON.stringify(input.payload),
      ],
    );
  });
}

export async function listRecommendationHistory(
  userId: number,
  recommendationId: number,
): Promise<RecommendationHistoryEntry[]> {
  const rows = await query<HistoryRow>(
    `SELECT * FROM recommendation_history
      WHERE recommendation_id = ? AND user_id = ? ORDER BY occurred_at ASC, id ASC`,
    [recommendationId, userId],
  );
  return rows.map((row) => ({
    id: Number(row.id),
    recommendationId: Number(row.recommendation_id),
    userId: Number(row.user_id),
    kind: row.kind,
    occurredAt: Number(row.occurred_at),
    actor: row.actor,
    source: row.source,
    payload: jsonObject(row.payload_json),
  }));
}
