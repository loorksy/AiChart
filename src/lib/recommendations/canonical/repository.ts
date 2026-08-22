import { execute, getDbBackend, query, queryOne, transaction } from "@/lib/db";
import { createLogger } from "@/lib/logger";
import { FEATURES } from "@/lib/agent/featureFlags";
import { assertRecommendationTransition, initialRecommendationStatus } from "./stateMachine";
import { applyRecommendationRevision } from "./revisions";
import { assertCompletePlan, PlanContractViolation } from "./planContract";
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
  market_regime: string | null;
  created_at: string | number;
  expires_at: number | null;
  status: string | null;
  status_reason: string | null;
  source: string | null;
  engine_version: string | null;
  entry_type: string | null;
  legacy_tracking_id: string | null;
  context_json: string | null;
  chart_drawings_json: string | null;
  plan_type: string | null;
  execution_state: string | null;
  decision_source: string | null;
  decision_model: string | null;
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
    marketRegime: row.market_regime ?? undefined,
    strategyId: "direct_analysis",
    strategyVersion: "1",
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
    contextJson: row.context_json ?? undefined,
    chartDrawingsJson: row.chart_drawings_json ?? undefined,
    planType: row.plan_type ?? null,
    executionState: row.execution_state ?? null,
    // Pre-column rows read as platform_agent — the only producer that existed
    // before the distinction did — never as an implied external client.
    decisionSource: row.decision_source ?? "platform_agent",
    decisionModel: row.decision_model ?? null,
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

  // Billing at the ONE choke point every surface funnels through (web,
  // Telegram, MCP alike). Two layers, both refused BEFORE any row exists:
  //
  //  - the trial cap: an atomic guarded increment (limit from billing_plan),
  //    so two concurrent creations cannot mint one past the cap;
  //  - the credit gate: expired subscription / empty balance are refused by
  //    NAME here — hiding a button somewhere is never the guard. The actual
  //    DEBIT happens inside the creation transaction below, so a failed
  //    insert rolls the charge back with it.
  //
  // Legacy imports are history, not new claims. Dynamic imports mirror the
  // usageMeter precedent and keep this persistence layer cycle-free.
  let paidDebit: { price: number } | null = null;
  if (!input.legacyImport && (direction === "buy" || direction === "sell")) {
    const { claimTrialRecommendation } = await import("@/lib/subscription/entitlement");
    const { resolveSpendGate } = await import("@/lib/billing/spend");
    const { t } = await import("@/lib/i18n");
    // The gate NAMES the account state FIRST — an expired subscriber must
    // hear "subscription expired", never the trial's message and never the
    // balance's — and only an allowed account then consumes a trial slot
    // (atomic guarded increment; the last-slot race is settled by the SQL
    // guard, not by this read).
    const decision = await resolveSpendGate(input.userId, "recommendation");
    const claim = decision.allowed
      ? await claimTrialRecommendation(input.userId)
      : ({ ok: false, reason: "blocked" } as const);
    if (!decision.allowed) {
      if (decision.code === "subscription_expired") {
        throw new RecommendationLifecycleError(
          "SUBSCRIPTION_EXPIRED",
          t("ar", "billing.refusal.subscription_expired"),
        );
      }
      if (decision.code === "insufficient_credits") {
        throw new RecommendationLifecycleError(
          "INSUFFICIENT_CREDITS",
          t("ar", "billing.refusal.insufficient_credits"),
        );
      }
      if (decision.code === "trial_exhausted") {
        throw new RecommendationLifecycleError(
          "TRIAL_RECOMMENDATION_LIMIT",
          t("ar", "billing.refusal.trial_exhausted"),
        );
      }
      throw new RecommendationLifecycleError(
        "RECOMMENDATION_INVALID_INPUT",
        t("ar", "billing.refusal.account_blocked"),
      );
    }
    if (!claim.ok) {
      // The gate allowed (e.g. enforcement off) but the trial counter is
      // spent — the product cap holds regardless of the billing switch.
      throw new RecommendationLifecycleError(
        "TRIAL_RECOMMENDATION_LIMIT",
        t("ar", "billing.refusal.trial_exhausted"),
      );
    }
    if (claim.mode === "paid" && decision.mode === "paid" && decision.price > 0) {
      paidDebit = { price: decision.price };
    }
  }

  // The Complete Plan Contract, enforced at the single creation choke point so
  // no surface can store a plan another surface would refuse. Only a legacy
  // import is exempt: a row written before the contract existed is history to
  // keep readable, not a new claim to grade.
  if (!input.legacyImport && (direction === "buy" || direction === "sell")) {
    const seed = input.initialRevision;
    try {
      assertCompletePlan({
        direction,
        planType: input.planType,
        executionState: input.executionState,
        entry: input.entry,
        entryLow: seed?.entryLow ?? input.entry,
        entryHigh: seed?.entryHigh ?? input.entry,
        stopLoss: input.stopLoss,
        targets,
        activationCondition: seed?.activationCondition,
        activationRule: seed?.activationRule,
        invalidationRule: seed?.invalidationRule,
        alternativeScenario: seed?.alternativeScenario,
        validityCandles: seed?.validityCandles,
      });
    } catch (error) {
      if (error instanceof PlanContractViolation) {
        throw new RecommendationLifecycleError(
          "RECOMMENDATION_INVALID_INPUT",
          error.message,
        );
      }
      throw error;
    }
  }

  // Phase-4 hard checks at the ONE write choke point (legacy imports are
  // history, not new claims). The agent loop is non-deterministic — a model
  // can skip a tool call — so these live HERE, in code, before the write.
  let resolvedEntryType: string | null = input.entryType ?? null;
  if (!input.legacyImport && (direction === "buy" || direction === "sell")) {
    const seed = input.initialRevision;

    // 1. Entry-fill semantics are explicit on every plan, and the known fatal
    //    incoherence (close-decided activation arming a touch-filled entry at
    //    the rule's own level) is refused by the write itself.
    const { isEntryType, resolveEntryType, validateEntryCoherence } = await import(
      "../entrySemantics"
    );
    const resolverInput = {
      declared: input.entryType,
      planType: (input.planType ?? null) as
        | "immediate"
        | "anticipatory"
        | "conditional"
        | null,
      activationRule: seed?.activationRule ?? null,
      retestZone: null,
    };
    // An EXPLICITLY declared fill type is graded as declared: a caller that
    // says "limit_touch" against a close-decided rule wrote the known fatal
    // pair, and the write REJECTS it rather than silently rewriting intent.
    // Absent/legacy spellings resolve to the honest type first.
    const declaredRaw = (input.entryType ?? "").toLowerCase();
    const entryType = isEntryType(declaredRaw)
      ? declaredRaw
      : resolveEntryType(resolverInput);
    resolvedEntryType = resolveEntryType(resolverInput);
    if (
      typeof input.entry === "number" &&
      Number.isFinite(input.entry) &&
      typeof input.stopLoss === "number" &&
      Number.isFinite(input.stopLoss) &&
      targets.length > 0
    ) {
      const problems = validateEntryCoherence({
        direction,
        entryType,
        entry: input.entry,
        stopLoss: input.stopLoss,
        targets,
        activationRule: seed?.activationRule ?? null,
      });
      if (problems.length) {
        throw new RecommendationLifecycleError(
          "RECOMMENDATION_INVALID_INPUT",
          `entry coherence: ${problems.map((p) => `${p.code}: ${p.detail}`).join("; ")}`,
        );
      }
    }

    // 2. Every factor carries its evidence — a graded, sourced dimension card.
    const { assertFactorEvidence, FactorEvidenceError } = await import(
      "../factorEvidence"
    );
    try {
      assertFactorEvidence(seed?.evidence ?? null);
    } catch (error) {
      if (error instanceof FactorEvidenceError) {
        throw new RecommendationLifecycleError(
          "RECOMMENDATION_INVALID_INPUT",
          error.message,
        );
      }
      throw error;
    }

    // 3. The gate record: a fresh, complete, non-vetoed chain must exist for
    //    this analysis. Missing, incomplete, vetoed, or stale ⇒ rejection.
    const gateRecords = await import("../gateRecords");
    try {
      await gateRecords.assertGateRecordsAllowCreation({
        userId: input.userId,
        analysisId: input.analysisId,
        symbol: input.symbol,
      });
    } catch (error) {
      if (
        error instanceof gateRecords.GateRecordMissingError ||
        error instanceof gateRecords.GateRecordIncompleteError ||
        error instanceof gateRecords.GateRecordStaleError ||
        error instanceof gateRecords.GateRecordVetoError
      ) {
        throw new RecommendationLifecycleError(
          "RECOMMENDATION_GATES_INCOMPLETE",
          error.message,
        );
      }
      throw error;
    }
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
         confidence, market_regime, expires_at, status, status_reason,
         source, engine_version, entry_type, legacy_tracking_id, rationale, factors,
         chart_drawings_json, pattern_name, analysis_tier, context_json,
         evidence_source, plan_type, execution_state, decision_source, decision_model,
         updated_at, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,${createdAtExpression})`,
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
        input.marketRegime ?? null,
        expiresAt,
        status,
        input.statusReason ?? "created",
        input.source ?? "web",
        input.engineVersion ?? "aichart-phase4-v1",
        resolvedEntryType,
        input.legacyTrackingId ?? null,
        input.rationale ?? null,
        input.factors?.length ? JSON.stringify(input.factors) : null,
        input.chartDrawingsJson ?? null,
        input.patternName ?? null,
        input.analysisTier ?? null,
        input.contextJson ?? null,
        input.evidenceSource ?? "direct_analysis",
        input.planType ?? null,
        input.executionState ?? null,
        input.decisionSource ?? "platform_agent",
        input.decisionModel ?? null,
        now,
        now,
      ],
    );
    // Phase B: consumption by path is a stated fact. One increment per real
    // creation — legacy migrations re-record history, they do not consume.
    // A counter only: nothing bills or blocks on it.
    if (!input.legacyImport) {
      await db.execute(
        `INSERT INTO recommendation_counters (user_id, decision_source, count, updated_at)
         VALUES (?,?,1,?)
         ON CONFLICT (user_id, decision_source) DO UPDATE SET
           count = recommendation_counters.count + 1,
           updated_at = excluded.updated_at`,
        [input.userId, input.decisionSource ?? "platform_agent", now],
      );
    }
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
      marketRegime: input.marketRegime,
      targets,
      confidence: clampConfidence(input.confidence),
      strategyId: "direct_analysis",
      strategyVersion: "1",
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
    // The credit debit rides the SAME transaction as the insert: a failed
    // creation rolls the charge back, and the conditional update re-checks
    // the balance so a race that emptied it since the gate read aborts the
    // whole creation as insufficient_credits. ref = the recommendation id —
    // the natural idempotency key.
    if (paidDebit) {
      const { debitCredits } = await import("@/lib/billing/credits");
      const debit = await debitCredits(
        {
          userId: input.userId,
          amount: paidDebit.price,
          kind: "debit_recommendation",
          ref: `rec:${id}`,
        },
        db,
      );
      if (!debit.ok) {
        const { t } = await import("@/lib/i18n");
        throw new RecommendationLifecycleError(
          "INSUFFICIENT_CREDITS",
          t("ar", "billing.refusal.insufficient_credits"),
        );
      }
    }
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
        activationRule: seed?.activationRule ?? null,
        invalidationRule: seed?.invalidationRule ?? null,
        alternativeScenario: seed?.alternativeScenario ?? null,
        validityCandles: seed?.validityCandles ?? null,
        expiresAt,
        reason: "initial recommendation",
        source: "agent",
        evidence: seed?.evidence ?? null,
        evidenceSnapshot: seed?.evidenceSnapshot ?? null,
        evidenceSourceSurface: seed?.evidenceSourceSurface ?? null,
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

/**
 * Move the LIVE execution state on the recommendation row. Revisions are
 * append-only and keep the state each revision declared; this column is the
 * one the tracker owns — it flips awaiting_activation → valid_now the moment
 * the market satisfies the plan's activation rule, so the card badge is a
 * function of the market, not of creation time.
 */
export async function updateCanonicalExecutionState(
  userId: number,
  recommendationId: number,
  executionState: string,
): Promise<void> {
  await execute(
    "UPDATE recommendations SET execution_state = ?, updated_at = ? WHERE id = ? AND user_id = ? AND (execution_state IS NULL OR execution_state <> ?)",
    [executionState, Date.now(), recommendationId, userId, executionState],
  );
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
