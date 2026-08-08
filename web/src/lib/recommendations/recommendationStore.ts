/**
 * Backward-compatible tracker adapter over the canonical recommendations table.
 * `tracked_recommendations` is retained only as a non-destructive legacy table;
 * no Phase 4 write or read path uses it as authority.
 */
import { execute, query } from "@/lib/db";
import type { TradabilityAssessment } from "./tradability";
import {
  createCanonicalRecommendation,
  getCanonicalRecommendationByReference,
  listAllActiveCanonicalRecommendations,
  listCanonicalRecommendations,
  listRecommendationOutcomes,
  listRecommendationTransitions,
  recordRecommendationOutcome,
  transitionRecommendation,
  updateCanonicalExecutionState,
  type CanonicalRecommendation,
  type RecommendationOutcome,
  type RecommendationStatus as CanonicalStatus,
} from "./canonical";
import type { ActivationEvidence } from "./activationRule";
import type {
  TrackedRecommendation,
  TrackedRecommendationOutcome,
  TrackedRecommendationStatus,
} from "./types";
import { getEffectiveRevision } from "./canonical/revisions";

interface LegacyTrackedRow {
  id: string;
  user_id: number;
  chat_id: string | null;
  analysis_id: string | null;
  symbol: string;
  interval: string;
  direction: string;
  entry_type: string;
  entry: number;
  stop_loss: number;
  targets: string;
  invalidation_level: number | null;
  status: TrackedRecommendationStatus;
  outcome: TrackedRecommendationOutcome;
  setup_type: string | null;
  rr: number | null;
  created_at: number;
  created_candle_time: number;
  expires_at: number;
  triggered_at: number | null;
  tp1_hit_at: number | null;
  tp2_hit_at: number | null;
  tp3_hit_at: number | null;
  sl_hit_at: number | null;
  invalidated_at: number | null;
  cancelled_at: number | null;
  expired_at: number | null;
  price_at_creation: number | null;
  last_checked_at: number | null;
}

const migratedLegacyScopes = new Set<string>();

function asExecutionState(
  value: string | null | undefined,
): TrackedRecommendation["executionState"] {
  return value === "valid_now" ||
    value === "awaiting_activation" ||
    value === "expired" ||
    value === "invalidated" ||
    value === "blocked"
    ? value
    : undefined;
}

function legacyTargets(raw: string): number[] {
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value)
      ? value.filter((item): item is number => typeof item === "number" && Number.isFinite(item))
      : [];
  } catch {
    return [];
  }
}

function legacyRowInput(row: LegacyTrackedRow): CreateTrackedRecommendationInput {
  return {
    // Pre-contract rows migrate as they are. Grading them against the Complete
    // Plan Contract would make every tracked read throw for tenants with
    // history, and inventing plan fields to pass it would be worse.
    legacyImport: true,
    id: row.id,
    userId: Number(row.user_id),
    chatId: row.chat_id ?? undefined,
    analysisId: row.analysis_id ?? undefined,
    symbol: row.symbol,
    interval: row.interval,
    direction: row.direction === "sell" ? "sell" : "buy",
    entryType:
      row.entry_type === "market" ? "market" : row.entry_type === "limit" ? "limit" : "pending",
    entry: Number(row.entry),
    stopLoss: Number(row.stop_loss),
    targets: legacyTargets(row.targets),
    invalidationLevel: row.invalidation_level == null ? undefined : Number(row.invalidation_level),
    status: row.status,
    outcome: row.outcome,
    setupType: row.setup_type ?? undefined,
    rr: row.rr == null ? undefined : Number(row.rr),
    createdAt: Number(row.created_at),
    createdCandleTime: Number(row.created_candle_time),
    expiresAt: Number(row.expires_at),
    triggeredAt: row.triggered_at == null ? undefined : Number(row.triggered_at),
    tp1HitAt: row.tp1_hit_at == null ? undefined : Number(row.tp1_hit_at),
    tp2HitAt: row.tp2_hit_at == null ? undefined : Number(row.tp2_hit_at),
    tp3HitAt: row.tp3_hit_at == null ? undefined : Number(row.tp3_hit_at),
    slHitAt: row.sl_hit_at == null ? undefined : Number(row.sl_hit_at),
    invalidatedAt: row.invalidated_at == null ? undefined : Number(row.invalidated_at),
    cancelledAt: row.cancelled_at == null ? undefined : Number(row.cancelled_at),
    expiredAt: row.expired_at == null ? undefined : Number(row.expired_at),
    priceAtCreation: row.price_at_creation == null ? undefined : Number(row.price_at_creation),
    lastCheckedAt: row.last_checked_at == null ? undefined : Number(row.last_checked_at),
  };
}

/** Non-destructive, idempotent import from the retired legacy table. */
export async function migrateLegacyTrackedRecommendations(userId?: number): Promise<number> {
  const scope = userId == null ? "all" : String(userId);
  if (migratedLegacyScopes.has(scope)) return 0;
  const rows = await query<LegacyTrackedRow>(
    `SELECT t.* FROM tracked_recommendations t
      LEFT JOIN recommendations r
        ON r.user_id = t.user_id AND r.legacy_tracking_id = t.id
      WHERE r.id IS NULL${userId == null ? "" : " AND t.user_id = ?"}
      ORDER BY t.created_at ASC, t.id ASC`,
    userId == null ? [] : [userId],
  );
  let imported = 0;
  for (const row of rows) {
    try {
      await createTrackedRecommendation(legacyRowInput(row));
      imported += 1;
    } catch (error) {
      const concurrent = await getCanonicalRecommendationByReference(
        Number(row.user_id),
        row.id,
      );
      if (!concurrent) throw error;
    }
  }
  migratedLegacyScopes.add(scope);
  return imported;
}

export type CreateTrackedRecommendationInput = Omit<
  TrackedRecommendation,
  | "triggeredAt"
  | "tp1HitAt"
  | "tp2HitAt"
  | "tp3HitAt"
  | "slHitAt"
  | "invalidatedAt"
  | "cancelledAt"
  | "expiredAt"
  | "lastCheckedAt"
> &
  Partial<
    Pick<
      TrackedRecommendation,
      | "triggeredAt"
      | "tp1HitAt"
      | "tp2HitAt"
      | "tp3HitAt"
      | "slHitAt"
      | "invalidatedAt"
      | "cancelledAt"
      | "expiredAt"
      | "lastCheckedAt"
    >
  > & {
    /**
     * The frozen evidence bundle and decision trace behind revision 1.
     *
     * Not part of the tracked record itself — they belong to the revision, so a
     * plan stays explainable from its own snapshot after the market has moved on
     * and the evidence has changed underneath it.
     */
    evidence?: Record<string, unknown> | null;
    /** The frozen bundle the brain decided on; see canonical/evidenceSnapshots.ts. */
    evidenceSnapshot?: Record<string, unknown> | null;
    evidenceSourceSurface?: string | null;
    decisionTrace?: Record<string, unknown> | null;
    /**
     * Where the decision's support came from — distinct from the support GRADE:
     * direct_analysis | strategy_supported | historical_memory | deep_research.
     */
    evidenceSource?: string | null;
    /** See CreateCanonicalRecommendationInput.legacyImport — migration only. */
    legacyImport?: boolean;
    /**
     * Reachability verdict for this plan, stored in the context blob where the
     * cards, the tracker and the calibration job already read it.
     *
     * The MCP bridge route assessed this and the platform's own engine did not,
     * so a far entry created from web chat was stored as an ordinary trade —
     * the exact defect the gate exists to prevent, still live on the surface
     * where it was reported.
     */
    tradability?: TradabilityAssessment | null;
  };

function legacyRisk(input: CreateTrackedRecommendationInput): Record<string, unknown> {
  return {
    invalidationLevel: input.invalidationLevel,
    setupType: input.setupType,
    plannedRr: input.rr,
    createdCandleTime: input.createdCandleTime,
    priceAtCreation: input.priceAtCreation,
    lastCheckedAt: input.lastCheckedAt,
    // Round-trips so the deterministic evaluator can enforce the contract's
    // candle-count validity, not only its wall-clock expiry.
    validityCandles: input.validityCandles,
  };
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function targetTimestamp(outcomes: RecommendationOutcome[], target: 1 | 2 | 3): number | undefined {
  return outcomes.find((item) => item.type === `TP${target}`)?.occurredAt;
}

function latestTimestamp(outcomes: RecommendationOutcome[], type: RecommendationOutcome["type"]): number | undefined {
  return outcomes.findLast((item) => item.type === type)?.occurredAt;
}

function legacyStatus(
  recommendation: CanonicalRecommendation,
  outcomes: RecommendationOutcome[],
): TrackedRecommendationStatus {
  const highestTarget = targetTimestamp(outcomes, 3)
    ? 3
    : targetTimestamp(outcomes, 2)
      ? 2
      : targetTimestamp(outcomes, 1)
        ? 1
        : 0;
  if (recommendation.status === "tp_hit") return "tp3_hit";
  if (recommendation.status === "sl_hit") return "sl_hit";
  if (recommendation.status === "expired") return "expired";
  if (recommendation.status === "cancelled") return "cancelled";
  if (recommendation.status === "invalidated") return "invalidated";
  if (recommendation.status === "closed" && highestTarget > 0) {
    return `tp${highestTarget}_hit` as TrackedRecommendationStatus;
  }
  if (recommendation.status === "partially_closed" && highestTarget > 0) {
    return `tp${highestTarget}_hit` as TrackedRecommendationStatus;
  }
  if (recommendation.status === "triggered" || latestTimestamp(outcomes, "Trailing")) {
    return "triggered";
  }
  return "pending_entry";
}

function legacyOutcome(
  recommendation: CanonicalRecommendation,
  outcomes: RecommendationOutcome[],
): TrackedRecommendationOutcome {
  if (recommendation.status === "sl_hit") return "loss";
  if (recommendation.status === "expired") return "expired";
  if (recommendation.status === "cancelled") return "cancelled";
  if (recommendation.status === "invalidated") return "invalidated";
  if (recommendation.status !== "tp_hit" && recommendation.status !== "closed") return "pending";
  if (targetTimestamp(outcomes, 3)) return "win_tp3";
  if (targetTimestamp(outcomes, 2)) return "win_tp2";
  if (targetTimestamp(outcomes, 1)) return "win_tp1";
  return recommendation.status === "tp_hit" ? "win_tp3" : "pending";
}

async function toTracked(recommendation: CanonicalRecommendation): Promise<TrackedRecommendation> {
  const [outcomes, transitions, effective] = await Promise.all([
    listRecommendationOutcomes(recommendation.userId, recommendation.recommendationId),
    listRecommendationTransitions(recommendation.userId, recommendation.recommendationId),
    getEffectiveRevision(
      recommendation.userId,
      recommendation.recommendationId,
    ).catch(() => null),
  ]);
  const risk = recommendation.risk;
  const triggeredAt = transitions.find((item) => item.toStatus === "triggered")?.occurredAt;
  return {
    id: recommendation.legacyTrackingId ?? String(recommendation.recommendationId),
    canonicalId: recommendation.recommendationId,
    userId: recommendation.userId,
    chatId: recommendation.chatId,
    analysisId: recommendation.analysisId,
    symbol: recommendation.symbol,
    interval: recommendation.timeframe,
    direction:
      effective?.direction ??
      (recommendation.direction === "sell" ? "sell" : "buy"),
    entryType:
      recommendation.entryType === "market"
        ? "market"
        : recommendation.entryType?.includes("limit")
          ? "limit"
          : "pending",
    entry: effective?.entry ?? recommendation.entry ?? 0,
    stopLoss: effective?.stopLoss ?? recommendation.stopLoss ?? 0,
    targets: effective?.targets.length ? effective.targets : recommendation.targets,
    invalidationLevel: numberValue(risk.invalidationLevel),
    status: legacyStatus(recommendation, outcomes),
    outcome: legacyOutcome(recommendation, outcomes),
    setupType: stringValue(risk.setupType) ?? recommendation.strategyId,
    rr: numberValue(risk.plannedRr),
    createdAt: recommendation.createdAt,
    createdCandleTime: numberValue(risk.createdCandleTime) ?? recommendation.createdAt,
    expiresAt: recommendation.expiresAt ?? recommendation.createdAt + 4 * 60 * 60 * 1000,
    triggeredAt,
    tp1HitAt: targetTimestamp(outcomes, 1),
    tp2HitAt: targetTimestamp(outcomes, 2),
    tp3HitAt: targetTimestamp(outcomes, 3),
    slHitAt: latestTimestamp(outcomes, "SL"),
    invalidatedAt: latestTimestamp(outcomes, "Invalidated"),
    cancelledAt: latestTimestamp(outcomes, "Cancelled"),
    expiredAt: latestTimestamp(outcomes, "Expired"),
    priceAtCreation: numberValue(risk.priceAtCreation),
    lastCheckedAt: numberValue(risk.lastCheckedAt),
    validityCandles:
      effective?.validityCandles ?? numberValue(risk.validityCandles),
    revisionNo: effective?.revisionNo,
    planType:
      effective?.planType === "immediate" ||
      effective?.planType === "anticipatory" ||
      effective?.planType === "conditional"
        ? effective.planType
        : undefined,
    // LIVE state from the row first (the tracker moves it as the market makes
    // the plan executable); the revision only keeps what it DECLARED at
    // creation. Reading the revision here is how a plan whose condition was
    // satisfied kept its card on "بانتظار التفعيل" forever.
    executionState:
      asExecutionState(recommendation.executionState) ??
      asExecutionState(effective?.executionState),
    entryLow: effective?.entryLow ?? undefined,
    entryHigh: effective?.entryHigh ?? undefined,
    triggerCondition: effective?.activationCondition ?? undefined,
    // Read from the EFFECTIVE revision, so a plan whose condition was revised
    // is graded against the condition currently in force — never a superseded
    // one, and never a newer one the operator has not seen.
    activationRule: effective?.activationRule ?? undefined,
    invalidationRule: effective?.invalidationRule ?? undefined,
    alternativeScenario: effective?.alternativeScenario ?? undefined,
    evidenceSnapshot: effective?.evidence,
  };
}

export async function createTrackedRecommendation(
  input: CreateTrackedRecommendationInput,
): Promise<TrackedRecommendation> {
  const recommendation = await createCanonicalRecommendation({
    // Same key and nesting the MCP write path uses, so one reader serves both.
    ...(input.tradability
      ? { contextJson: JSON.stringify({ tradability: input.tradability }) }
      : {}),
    legacyImport: input.legacyImport,
    userId: input.userId,
    analysisId: input.analysisId,
    sessionId: input.chatId,
    chatId: input.chatId,
    symbol: input.symbol,
    market: "forex",
    timeframe: input.interval,
    direction: input.direction,
    entry: input.entry,
    stopLoss: input.stopLoss,
    targets: input.targets,
    risk: legacyRisk(input),
    confidence: 0,
    strategyId: input.setupType ?? "unspecified",
    strategyVersion: "1",
    createdAt: input.createdAt,
    expiresAt: input.expiresAt,
    status: "active",
    statusReason: "created through tracked recommendation adapter",
    source: "agent-tracker",
    engineVersion: "aichart-phase4-v1",
    entryType: input.entryType,
    legacyTrackingId: input.id,
    // The three layers and the evidence grade, persisted rather than kept in
    // memory: the tracker needs the activation condition to evaluate, and the
    // journal needs the plan type to report.
    planType: input.planType ?? null,
    executionState: input.executionState ?? null,
    statisticalSupport: input.statisticalSupport ?? null,
    evidenceSource: input.evidenceSource ?? null,
    initialRevision: {
      entryLow: input.entryLow ?? null,
      entryHigh: input.entryHigh ?? null,
      activationCondition: input.triggerCondition ?? null,
      activationRule: input.activationRule ?? null,
      invalidationRule: input.invalidationRule ?? null,
      alternativeScenario: input.alternativeScenario ?? null,
      validityCandles: input.validityCandles ?? null,
      evidence: input.evidence ?? null,
      evidenceSnapshot: input.evidenceSnapshot ?? null,
      evidenceSourceSurface: input.evidenceSourceSurface ?? null,
      decisionTrace: input.decisionTrace ?? null,
    },
  });
  if (
    input.status !== "pending_entry" ||
    input.outcome !== "pending" ||
    input.triggeredAt != null ||
    input.tp1HitAt != null ||
    input.tp2HitAt != null ||
    input.tp3HitAt != null
  ) {
    return (
      (await updateTrackedRecommendation(input.userId, input.id, {
        status: input.status,
        outcome: input.outcome,
        triggeredAt: input.triggeredAt,
        tp1HitAt: input.tp1HitAt ?? (input.outcome === "win_tp1" ? input.createdAt : undefined),
        tp2HitAt: input.tp2HitAt ?? (input.outcome === "win_tp2" ? input.createdAt : undefined),
        tp3HitAt: input.tp3HitAt ?? (input.outcome === "win_tp3" ? input.createdAt : undefined),
        slHitAt: input.slHitAt ?? (input.outcome === "loss" ? input.createdAt : undefined),
        invalidatedAt:
          input.invalidatedAt ?? (input.outcome === "invalidated" ? input.createdAt : undefined),
        cancelledAt:
          input.cancelledAt ?? (input.outcome === "cancelled" ? input.createdAt : undefined),
        expiredAt: input.expiredAt ?? (input.outcome === "expired" ? input.createdAt : undefined),
        lastCheckedAt: input.lastCheckedAt ?? input.createdAt,
      })) ?? (await toTracked(recommendation))
    );
  }
  return toTracked(recommendation);
}

export async function getTrackedRecommendation(
  userId: number,
  id: string,
): Promise<TrackedRecommendation | null> {
  await migrateLegacyTrackedRecommendations(userId);
  const recommendation = await getCanonicalRecommendationByReference(userId, id);
  return recommendation ? toTracked(recommendation) : null;
}

export async function listTrackedRecommendations(
  userId: number,
  opts: { limit?: number } = {},
): Promise<TrackedRecommendation[]> {
  await migrateLegacyTrackedRecommendations(userId);
  const recommendations = await listCanonicalRecommendations(userId, { limit: opts.limit });
  return Promise.all(recommendations.map(toTracked));
}

export async function listActiveTrackedRecommendations(opts: {
  userId?: number;
  limit?: number;
} = {}): Promise<TrackedRecommendation[]> {
  await migrateLegacyTrackedRecommendations(opts.userId);
  const recommendations =
    opts.userId == null
      ? await listAllActiveCanonicalRecommendations(opts.limit)
      : await listCanonicalRecommendations(opts.userId, {
          limit: opts.limit,
          activeOnly: true,
        });
  return Promise.all(recommendations.map(toTracked));
}

export interface TrackedStatusPatch {
  status: TrackedRecommendationStatus;
  outcome: TrackedRecommendationOutcome;
  triggeredAt?: number;
  tp1HitAt?: number;
  tp2HitAt?: number;
  tp3HitAt?: number;
  slHitAt?: number;
  invalidatedAt?: number;
  cancelledAt?: number;
  expiredAt?: number;
  lastCheckedAt?: number;
  reason?: string;
  /**
   * The LIVE execution state derived by the tracker from the market. Written to
   * the recommendation row (revisions stay append-only) — omitting it leaves
   * the stored state untouched.
   */
  executionState?: TrackedRecommendation["executionState"];
  /** Which candle satisfied the activation rule — recorded as the trigger reason. */
  activationEvidence?: ActivationEvidence;
}

async function move(
  recommendation: CanonicalRecommendation,
  status: CanonicalStatus,
  timestamp: number,
  reason: string,
): Promise<CanonicalRecommendation> {
  if (recommendation.status === status) return recommendation;
  return transitionRecommendation({
    userId: recommendation.userId,
    recommendationId: recommendation.recommendationId,
    toStatus: status,
    timestamp,
    trigger: "candle_warehouse",
    actor: "recommendation_tracker",
    source: "deterministic_tracker",
    reason,
  });
}

async function ensureTriggered(
  recommendation: CanonicalRecommendation,
  timestamp: number,
  reason?: string,
): Promise<CanonicalRecommendation> {
  if (recommendation.status === "active") {
    return move(recommendation, "triggered", timestamp, reason ?? "entry condition reached");
  }
  return recommendation;
}

function plannedR(recommendation: CanonicalRecommendation, targetIndex: 1 | 2 | 3): number | undefined {
  const target = recommendation.targets[targetIndex - 1];
  if (target == null || recommendation.entry == null || recommendation.stopLoss == null) return undefined;
  const risk = Math.abs(recommendation.entry - recommendation.stopLoss);
  return risk > 0 ? Math.abs(target - recommendation.entry) / risk : undefined;
}

async function appendTrackerOutcome(
  recommendation: CanonicalRecommendation,
  type: RecommendationOutcome["type"],
  occurredAt: number,
  targetIndex?: 1 | 2 | 3,
): Promise<void> {
  await recordRecommendationOutcome({
    userId: recommendation.userId,
    recommendationId: recommendation.recommendationId,
    type,
    occurredAt,
    targetIndex,
    price: targetIndex ? recommendation.targets[targetIndex - 1] : recommendation.stopLoss,
    rMultiple: targetIndex ? plannedR(recommendation, targetIndex) : type === "SL" ? -1 : undefined,
    source: "deterministic_tracker",
    evidence: {
      method: "complete_ohlc_candles",
      direction: recommendation.direction,
      validated: false,
    },
    dedupeKey: `tracker:${type}`,
  });
}

export async function updateTrackedRecommendation(
  userId: number,
  id: string,
  patch: TrackedStatusPatch,
): Promise<TrackedRecommendation | null> {
  let recommendation = await getCanonicalRecommendationByReference(userId, id);
  if (!recommendation) return null;
  const now = patch.lastCheckedAt ?? Date.now();
  if (patch.triggeredAt || ["triggered", "tp1_hit", "tp2_hit", "tp3_hit"].includes(patch.status)) {
    recommendation = await ensureTriggered(
      recommendation,
      patch.triggeredAt ?? now,
      // The proof beats the generic reason: "3 إغلاق تحت 4348.27 على 15m"
      // tells the operator WHICH candle satisfied the rule.
      patch.activationEvidence?.detail ?? patch.reason,
    );
  }
  if (patch.executionState) {
    await updateCanonicalExecutionState(
      userId,
      recommendation.recommendationId,
      patch.executionState,
    ).catch(() => undefined);
    recommendation = { ...recommendation, executionState: patch.executionState };
  }
  if (patch.tp1HitAt) {
    await appendTrackerOutcome(recommendation, "TP1", patch.tp1HitAt, 1);
    if (recommendation.status === "triggered") {
      recommendation = await move(
        recommendation,
        "partially_closed",
        patch.tp1HitAt,
        patch.reason ?? "TP1 reached",
      );
    }
  }
  if (patch.tp2HitAt) {
    await appendTrackerOutcome(recommendation, "TP2", patch.tp2HitAt, 2);
    if (recommendation.status === "triggered") {
      recommendation = await move(
        recommendation,
        "partially_closed",
        patch.tp2HitAt,
        patch.reason ?? "TP2 reached",
      );
    }
  }
  if (patch.tp3HitAt || patch.status === "tp3_hit") {
    const at = patch.tp3HitAt ?? now;
    await appendTrackerOutcome(recommendation, "TP3", at, 3);
    if (recommendation.status === "triggered") {
      recommendation = await move(
        recommendation,
        "partially_closed",
        at,
        patch.reason ?? "targets reached",
      );
    }
    if (recommendation.status === "partially_closed") {
      recommendation = await move(
        recommendation,
        "tp_hit",
        at,
        patch.reason ?? "final target reached",
      );
    }
  } else if (patch.status === "sl_hit") {
    const at = patch.slHitAt ?? now;
    await appendTrackerOutcome(recommendation, "SL", at);
    recommendation = await move(
      recommendation,
      "sl_hit",
      at,
      patch.reason ?? "stop loss reached",
    );
  } else if (patch.status === "expired") {
    const at = patch.expiredAt ?? now;
    await appendTrackerOutcome(recommendation, "Expired", at);
    recommendation = await move(
      recommendation,
      "expired",
      at,
      patch.reason ?? "recommendation expired",
    );
  } else if (patch.status === "cancelled") {
    const at = patch.cancelledAt ?? now;
    await appendTrackerOutcome(recommendation, "Cancelled", at);
    recommendation = await move(
      recommendation,
      "cancelled",
      at,
      patch.reason ?? "recommendation cancelled",
    );
  } else if (patch.status === "invalidated") {
    const at = patch.invalidatedAt ?? now;
    await appendTrackerOutcome(recommendation, "Invalidated", at);
    recommendation = await move(
      recommendation,
      "invalidated",
      at,
      patch.reason ?? "setup invalidated",
    );
  } else if (
    (patch.outcome === "win_tp1" || patch.outcome === "win_tp2") &&
    recommendation.status === "partially_closed"
  ) {
    if (patch.slHitAt) {
      await recordRecommendationOutcome({
        userId,
        recommendationId: recommendation.recommendationId,
        type: "ManualClose",
        occurredAt: patch.slHitAt,
        source: "deterministic_tracker",
        evidence: { exitReason: "stop_after_partial_target" },
        dedupeKey: "tracker:partial-close",
      });
    }
    recommendation = await move(
      recommendation,
      "closed",
      now,
      patch.reason ?? `legacy partial outcome ${patch.outcome}`,
    );
  }
  if (patch.lastCheckedAt != null) {
    const nextRisk = {
      ...recommendation.risk,
      lastCheckedAt: patch.lastCheckedAt,
    };
    await execute(
      `UPDATE recommendations
          SET risk_json = ?, updated_at = ?
        WHERE id = ? AND user_id = ?`,
      [
        JSON.stringify(nextRisk),
        patch.lastCheckedAt,
        recommendation.recommendationId,
        userId,
      ],
    );
    recommendation = { ...recommendation, risk: nextRisk };
  }
  return toTracked(recommendation);
}

export async function cancelTrackedRecommendation(
  userId: number,
  id: string,
): Promise<TrackedRecommendation | null> {
  const existing = await getTrackedRecommendation(userId, id);
  if (!existing) return null;
  if (existing.outcome !== "pending") return existing;
  return updateTrackedRecommendation(userId, id, {
    status: "cancelled",
    outcome: "cancelled",
    cancelledAt: Date.now(),
  });
}
