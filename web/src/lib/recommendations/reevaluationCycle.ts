/**
 * Consuming a re-evaluation trigger (constitution §6, plan §7 B.9).
 *
 * The trigger half was already there: the tracker notices, the trigger is bounded
 * and recorded. This is the other half — the part that makes the constitutional
 * ordering real rather than described:
 *
 *     trigger → fresh evidence bundle → the SAME brain → compare → confirm | revise
 *
 * Three properties are load-bearing and each is enforced here rather than trusted:
 *
 *  1. **The same brain.** `runUnifiedChartAgent` is the entry point the original
 *     analysis used. A second, cheaper "re-check" path would be a second brain
 *     with its own habits, and the two would drift.
 *
 *  2. **A whole bundle.** The cycle re-runs the full evidence pipeline. Deciding
 *     from the trigger's own payload — "the spread widened, so widen the stop" —
 *     is exactly the heuristic the architecture forbids.
 *
 *  3. **A revision only when something changed.** An unchanged decision records
 *     `confirmed` and writes no revision. Manufacturing an identical revision on
 *     every sweep would bury the real changes in a list of non-events and make
 *     the effective-revision number meaningless.
 *
 * The cycle never runs twice for one recommendation at a time, and its output goes
 * through `applyRecommendationRevision` like every other change.
 */
import { query, transaction } from "@/lib/db";
import { withLock } from "@/lib/locks";
import { createLogger } from "@/lib/logger";
import { metrics } from "@/lib/metrics";
import { FEATURES } from "@/lib/agent/featureFlags";
import { runUnifiedChartAgent } from "@/lib/agent/orchestrator";
import type { AgentFinalResult } from "@/lib/agent/types";
import type { SynthesizerDeps } from "@/lib/agent/agents/finalDecisionSynthesizer";
import {
  applyRecommendationRevision,
  evidenceFingerprint,
  getEffectiveRevision,
  type RecommendationRevision,
} from "./canonical/revisions";
import { getCanonicalRecommendation } from "./canonical/repository";
import { isTerminalRecommendationStatus } from "./canonical/stateMachine";
import { manageOpenTradeAfterRevision } from "./tradeManagement";
import { notifyLifecycleEvents } from "./lifecycleNotifier";
import type { LifecycleEvent } from "./lifecycleEvents";
import {
  reevaluationClaimKey,
  type ReevaluationReason,
  type ReevaluationTrigger,
} from "./reevaluationTriggers";

const log = createLogger("recommendations:reevaluation-cycle");

/** What a completed cycle concluded. */
export type CycleVerdict = "confirmed" | "revised" | "invalidated" | "skipped";

export interface CycleResult {
  recommendationId: string;
  canonicalId: number | null;
  verdict: CycleVerdict;
  /** The revision created, when the decision actually changed. */
  revision: RecommendationRevision | null;
  /** Fingerprint of the bundle this cycle decided on. */
  evidenceHash: string | null;
  /** Operator-readable why. */
  detail: string;
  trigger: ReevaluationTrigger;
  /** Retryable skips leave the durable claim pending for the next consumer. */
  retryable?: boolean;
}

/** How the brain is reached. Injectable so tests exercise the real comparison. */
export interface CycleDeps {
  runBrain?: (input: {
    symbol: string;
    interval: string;
    userId: number;
    reason: string;
  }) => Promise<AgentFinalResult | null>;
  /** Provider seam passed into the real unified brain by integration tests. */
  synthesizerDeps?: SynthesizerDeps;
  /** Suppress external delivery while still claiming the notification dedupe. */
  silentNotifications?: boolean;
  /** Tracker batches its own events; other orchestration callers notify here. */
  notifyInCycle?: boolean;
}

/**
 * The default brain call: the same entry point a chat analysis uses.
 *
 * `canExecute: false` because a re-evaluation decides, it does not trade. The
 * plan it produces flows to `applyRecommendationRevision`, and execution stays
 * where it always was — behind the operator's mode and `executeIntent`.
 */
async function defaultRunBrain(input: {
  symbol: string;
  interval: string;
  userId: number;
  reason: string;
}, synthesizerDeps?: SynthesizerDeps): Promise<AgentFinalResult | null> {
  return runUnifiedChartAgent({
    surface: "internal",
    userMessage: `Re-analyze the active trade plan for ${input.symbol} on ${input.interval}. Trigger: ${input.reason}`,
    chartContext: { symbol: input.symbol, interval: input.interval },
    requestContext: {
      requestId: `reeval-${input.symbol}-${Date.now()}`,
      userId: input.userId,
      emitActivity: () => {},
    },
    canExecute: false,
    purpose: "reevaluation",
    synthesizerDeps,
  }).catch((error: unknown) => {
    log.warn("re-evaluation brain call failed", {
      symbol: input.symbol,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  });
}

/** The plan fields whose change is worth a new revision. */
interface ComparableDecision {
  direction: "buy" | "sell";
  planType: string | null;
  entry: number | null;
  entryLow: number | null;
  entryHigh: number | null;
  stopLoss: number | null;
  targets: number[];
  validityCandles: number | null;
  alternativeScenario: string | null;
  executionState: string | null;
  activationCondition: string | null;
  invalidationRule: string | null;
}

function comparableFromResult(result: AgentFinalResult): ComparableDecision | null {
  const rec = result.recommendation;
  if (!rec || (rec.action !== "buy" && rec.action !== "sell")) return null;
  return {
    direction: rec.action,
    planType: rec.planType ?? null,
    entry: rec.entry ?? null,
    entryLow: rec.entryZone?.low ?? rec.entry ?? null,
    entryHigh: rec.entryZone?.high ?? rec.entry ?? null,
    stopLoss: rec.stop_loss ?? null,
    targets: rec.targets ?? [],
    validityCandles: rec.validityCandles ?? null,
    alternativeScenario: rec.alternativeScenario ?? null,
    executionState: rec.executionState ?? null,
    activationCondition: rec.triggerCondition ?? null,
    invalidationRule: rec.invalidationRule ?? null,
  };
}

function comparableFromRevision(revision: RecommendationRevision): ComparableDecision {
  return {
    direction: revision.direction,
    planType: revision.planType,
    entry: revision.entry,
    entryLow: revision.entryLow ?? revision.entry,
    entryHigh: revision.entryHigh ?? revision.entry,
    stopLoss: revision.stopLoss,
    targets: revision.targets,
    validityCandles: revision.validityCandles,
    alternativeScenario: revision.alternativeScenario,
    executionState: revision.executionState,
    activationCondition: revision.activationCondition,
    invalidationRule: revision.invalidationRule,
  };
}

/** Price equality at instrument scale — a float artefact is not a plan change. */
function samePrice(a: number | null, b: number | null): boolean {
  if (a == null || b == null) return a === b;
  const scale = Math.max(Math.abs(a), Math.abs(b), 1);
  return Math.abs(a - b) <= scale * 1e-6;
}

/**
 * Did the decision actually change?
 *
 * Direction, plan type, levels, validity, and the alternative scenario. Anything
 * else — wording, confidence drift, a reordered reason list — is the same plan
 * described again, and does not deserve a revision.
 */
export function decisionChanged(
  before: ComparableDecision,
  after: ComparableDecision,
): { changed: boolean; fields: string[] } {
  const fields: string[] = [];
  if (before.direction !== after.direction) fields.push("direction");
  if ((before.planType ?? null) !== (after.planType ?? null)) fields.push("plan_type");
  if (!samePrice(before.entry, after.entry)) fields.push("entry");
  if (!samePrice(before.entryLow, after.entryLow)) fields.push("entry_low");
  if (!samePrice(before.entryHigh, after.entryHigh)) fields.push("entry_high");
  if (!samePrice(before.stopLoss, after.stopLoss)) fields.push("stop_loss");
  if (
    before.targets.length !== after.targets.length ||
    before.targets.some((value, index) => !samePrice(value, after.targets[index] ?? null))
  ) {
    fields.push("targets");
  }
  if ((before.validityCandles ?? null) !== (after.validityCandles ?? null)) {
    fields.push("validity");
  }
  if ((before.alternativeScenario ?? "") !== (after.alternativeScenario ?? "")) {
    fields.push("scenario");
  }
  if ((before.executionState ?? null) !== (after.executionState ?? null)) {
    fields.push("execution_state");
  }
  if (
    (before.activationCondition ?? "") !==
    (after.activationCondition ?? "")
  ) {
    fields.push("activation_condition");
  }
  if ((before.invalidationRule ?? "") !== (after.invalidationRule ?? "")) {
    fields.push("invalidation_rule");
  }
  return { changed: fields.length > 0, fields };
}

/**
 * Was the revision this cycle would transition FROM already recorded as the
 * origin of a completed "revised"/"invalidated" cycle? Used to recognize a
 * crash-recovery retry: a revision that committed but whose cycle (recordCycle
 * + broker sync + notification) never ran because the process died in between.
 */
async function hasRecordedTransitionFrom(
  recommendationId: string,
  fromRevisionNo: number,
): Promise<boolean> {
  const rows = await query<{ found: number }>(
    `SELECT 1 AS found FROM recommendation_reevaluations
      WHERE recommendation_id = ? AND revision_no = ? AND outcome IN ('revised', 'invalidated')
      LIMIT 1`,
    [recommendationId, fromRevisionNo],
  );
  return rows.length > 0;
}

/**
 * Record what a cycle concluded, whether or not it produced a revision.
 *
 * `confirmed` is a real outcome and must be visible: "the market moved and the
 * agent looked again and stood by the plan" is different information from "nobody
 * looked", and an operator who cannot tell them apart cannot trust either.
 */
async function recordCycle(input: {
  trigger: ReevaluationTrigger;
  verdict: CycleVerdict;
  evidenceHash: string | null;
  detail: string;
  evidence: Record<string, unknown>;
  decisionTrace: Record<string, unknown>;
  /** False for a transient failure: the DB claim remains available for retry. */
  completeClaim?: boolean;
}): Promise<void> {
  const completedAt = Date.now();
  await transaction(async (db) => {
    await db.execute(
      `INSERT INTO recommendation_reevaluations
         (recommendation_id, user_id, symbol, reason, detail, source, revision_no,
          outcome, raised_at, dedupe_key, evidence_hash, trigger_payload_json,
          evidence_json, decision_trace_json, completed_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT (recommendation_id, dedupe_key) DO NOTHING`,
      [
        input.trigger.recommendationId,
        input.trigger.userId,
        input.trigger.symbol,
        input.trigger.reason,
        input.detail,
        input.trigger.source,
        input.trigger.revisionNo,
        input.verdict,
        input.trigger.raisedAt,
        `${input.trigger.revisionNo ?? 0}:${input.trigger.reason}:${input.trigger.raisedAt}:${input.verdict}`,
        input.evidenceHash,
        JSON.stringify({
          reason: input.trigger.reason,
          detail: input.trigger.detail,
          source: input.trigger.source,
          revisionNo: input.trigger.revisionNo,
          raisedAt: input.trigger.raisedAt,
          idempotencyKey: input.trigger.idempotencyKey ?? null,
        }),
        JSON.stringify(input.evidence),
        JSON.stringify(input.decisionTrace),
        completedAt,
      ],
    );
    if (input.completeClaim !== false) {
      await db.execute(
        `UPDATE recommendation_reevaluations
            SET completed_at = ?
          WHERE recommendation_id = ? AND dedupe_key = ?
            AND outcome = 'cycle_requested' AND completed_at IS NULL`,
        [
          completedAt,
          input.trigger.recommendationId,
          reevaluationClaimKey(input.trigger),
        ],
      );
    }
  });
}

function lifecycleEventFor(result: CycleResult): LifecycleEvent | null {
  if (result.verdict === "skipped") return null;
  const revisionNo =
    result.revision?.revisionNo ?? result.trigger.revisionNo ?? null;
  return {
    type:
      result.verdict === "confirmed"
        ? "reevaluation_confirmed"
        : result.verdict === "invalidated"
          ? "scenario_changed"
          : "entry_updated",
    recommendationId: result.trigger.recommendationId,
    symbol: result.trigger.symbol,
    revisionNo,
    dedupeKey:
      result.verdict === "confirmed"
        ? `${result.trigger.recommendationId}:${result.trigger.revisionNo ?? 0}:reeval:confirmed:${result.trigger.reason}:${result.trigger.raisedAt}`
        : `${result.trigger.recommendationId}:${revisionNo ?? 0}:reeval:${result.verdict}`,
    detail: result.detail,
    terminal: result.verdict === "invalidated",
    occurredAt: Date.now(),
  };
}

async function announceCycle(
  result: CycleResult,
  silent: boolean,
): Promise<void> {
  const event = lifecycleEventFor(result);
  if (!event) return;
  await notifyLifecycleEvents(result.trigger.userId, [event], { silent }).catch(
    (error: unknown) => {
      log.warn("failed to announce re-evaluation verdict", {
        recommendationId: result.recommendationId,
        error: error instanceof Error ? error.message : String(error),
      });
    },
  );
}

/**
 * Run one cycle.
 *
 * Serialized on its OWN lock, deliberately not the recommendation's.
 * `applyRecommendationRevision` takes the recommendation lock itself and the lock
 * is not reentrant, so holding it across the cycle deadlocked every revision —
 * the cycle refused its own write. A separate `reevaluation:<id>` lock gives the
 * property that actually matters (one cycle per plan at a time, so one trigger
 * cannot pay for a second model call while another is deciding) and leaves the
 * revision mechanism to guard the write, which it already does inside its own
 * transaction by deriving the new number from the current pointer.
 *
 * A cycle that cannot take the lock is skipped rather than queued: if the
 * condition is real it will be raised again on the next sweep.
 */
export async function runReevaluationCycle(
  trigger: ReevaluationTrigger,
  canonicalId: number,
  deps: CycleDeps = {},
): Promise<CycleResult> {
  const skip = (detail: string, retryable = true): CycleResult => ({
    recommendationId: trigger.recommendationId,
    canonicalId,
    verdict: "skipped",
    revision: null,
    evidenceHash: null,
    detail,
    trigger,
    retryable,
  });

  if (!FEATURES.reevaluationTriggersV1()) {
    return skip("phase disabled");
  }

  const locked = await withLock(
    `reevaluation:${canonicalId}`,
    120_000,
    async (): Promise<CycleResult> => {
      const rec = await getCanonicalRecommendation(trigger.userId, canonicalId);
      if (!rec) return skip("recommendation not found", false);
      // A finished plan is history, not a draft. Re-deciding it would produce a
      // revision the state machine correctly refuses.
      if (isTerminalRecommendationStatus(rec.status)) {
        return skip(`terminal status ${rec.status}`, false);
      }

      const effective = await getEffectiveRevision(trigger.userId, canonicalId);
      if (!effective) {
        return skip("no effective revision to compare against", false);
      }
      if (
        trigger.revisionNo != null &&
        trigger.revisionNo !== effective.revisionNo
      ) {
        // Recovery path: a crash between applyRecommendationRevision (committed)
        // and recordCycle (never ran) would otherwise let this retry silently
        // close the claim as "stale trigger, nothing happened" — losing the
        // notification, the broker SL/TP sync, and the audit trail for a
        // revision that really did land. Only this function's own "changed"
        // branch writes source:"market_update", and a cycle that finished
        // normally always records the transition it made in the same
        // synchronous flow. If the effective revision looks like ours but was
        // never recorded, finish its bookkeeping instead of burying it.
        const orphaned =
          effective.source === "market_update" &&
          !(await hasRecordedTransitionFrom(
            trigger.recommendationId,
            effective.revisionNo - 1,
          ));
        if (orphaned) {
          const verdict: CycleVerdict =
            effective.executionState === "invalidated" ? "invalidated" : "revised";
          const detail = `${rec.symbol}: استُؤنفت دورة إعادة تقييم توقفت بعد تطبيق النسخة ${effective.revisionNo} — لم تصل الإشعارات أو مزامنة الصفقة سابقاً.`;
          await recordCycle({
            trigger,
            verdict,
            evidenceHash: effective.evidenceHash,
            detail,
            evidence: effective.evidence,
            decisionTrace: effective.decisionTrace,
          });
          metrics.reevaluationVerdicts.inc({ verdict });
          await manageOpenTradeAfterRevision({
            userId: trigger.userId,
            recommendationId: canonicalId,
            revision: effective,
          }).catch((error: unknown) => {
            log.warn("post-open trade management failed (resumed cycle)", {
              recommendationId: trigger.recommendationId,
              error: error instanceof Error ? error.message : String(error),
            });
          });
          const resumed: CycleResult = {
            recommendationId: trigger.recommendationId,
            canonicalId,
            verdict,
            revision: effective,
            evidenceHash: effective.evidenceHash,
            detail,
            trigger,
          };
          if (deps.notifyInCycle !== false) {
            await announceCycle(resumed, deps.silentNotifications === true);
          }
          return resumed;
        }
        return skip(
          `stale trigger revision ${trigger.revisionNo}; effective ${effective.revisionNo}`,
          false,
        );
      }

      metrics.reevaluationCycles.inc({ reason: trigger.reason });

      // The whole bundle, from the same brain, on fresh market data.
      const result = deps.runBrain
        ? await deps.runBrain({
            symbol: rec.symbol,
            interval: rec.timeframe,
            userId: trigger.userId,
            reason: trigger.detail,
          })
        : await defaultRunBrain(
            {
              symbol: rec.symbol,
              interval: rec.timeframe,
              userId: trigger.userId,
              reason: trigger.detail,
            },
            deps.synthesizerDeps,
          );
      if (!result) return skip("brain produced no decision");

      const after = comparableFromResult(result);
      if (!after) {
        // An operational blocker is not a verdict about the plan. Saying nothing
        // is correct: the previous decision stands until it can be re-examined.
        return skip("no decision in result (operational blocker)");
      }

      const evidence = result.evidenceSnapshot;
      if (!evidence) return skip("brain returned no complete evidence snapshot");
      const decisionTrace =
        (result.decisionTrace as Record<string, unknown> | undefined) ?? {};
      const evidenceHash = evidenceFingerprint(evidence);
      const before = comparableFromRevision(effective);
      const { changed, fields } = decisionChanged(before, after);

      if (!changed) {
        const detail = `${rec.symbol}: أُعيد التقييم بعد ${trigger.reason} والقرار لم يتغيّر — النسخة ${effective.revisionNo} قائمة.`;
        await recordCycle({
          trigger,
          verdict: "confirmed",
          evidenceHash,
          detail,
          evidence,
          decisionTrace,
        });
        metrics.reevaluationVerdicts.inc({ verdict: "confirmed" });
        const confirmed: CycleResult = {
          recommendationId: trigger.recommendationId,
          canonicalId,
          verdict: "confirmed",
          revision: null,
          evidenceHash,
          detail,
          trigger,
        };
        if (deps.notifyInCycle !== false) {
          await announceCycle(confirmed, deps.silentNotifications === true);
        }
        return confirmed;
      }

      // Changed. The revision mechanism is the only thing that writes a plan, and
      // it carries the snapshot and trace so the change stays explainable.
      const revision = await applyRecommendationRevision({
        userId: trigger.userId,
        recommendationId: canonicalId,
        revision: {
          direction: after.direction,
          planType: after.planType,
          executionState: result.recommendation?.executionState ?? null,
          entry: after.entry,
          entryLow: after.entryLow,
          entryHigh: after.entryHigh,
          stopLoss: after.stopLoss,
          targets: after.targets,
          activationCondition: result.recommendation?.triggerCondition ?? null,
          invalidationRule: result.recommendation?.invalidationRule ?? null,
          alternativeScenario: after.alternativeScenario,
          validityCandles: after.validityCandles,
          reason: `إعادة تقييم (${trigger.reason}): تغيّر ${fields.join("، ")}.`,
          source: "market_update",
          evidence,
          decisionTrace,
        },
      });

      const verdict: CycleVerdict =
        result.recommendation?.executionState === "invalidated" ? "invalidated" : "revised";
      const detail = `${rec.symbol}: أُعيد التقييم بعد ${trigger.reason} — تغيّر ${fields.join("، ")} (النسخة ${revision.revisionNo}).`;
      await recordCycle({
        trigger,
        verdict,
        evidenceHash,
        detail,
        evidence,
        decisionTrace,
      });
      metrics.reevaluationVerdicts.inc({ verdict });

      // Plan §14: when this plan's trade is ALREADY OPEN, the recorded change
      // must reach the broker too — through the trade-management layer, which
      // proposes an approval in advisory mode and uses the existing modify path
      // under the standing grant in auto mode. Best-effort: a failed sync never
      // undoes the revision, and the layer decides nothing itself.
      await manageOpenTradeAfterRevision({
        userId: trigger.userId,
        recommendationId: canonicalId,
        revision,
      }).catch((error: unknown) => {
        log.warn("post-open trade management failed", {
          recommendationId: trigger.recommendationId,
          error: error instanceof Error ? error.message : String(error),
        });
      });

      const completed: CycleResult = {
        recommendationId: trigger.recommendationId,
        canonicalId,
        verdict,
        revision,
        evidenceHash,
        detail,
        trigger,
      };
      if (deps.notifyInCycle !== false) {
        await announceCycle(completed, deps.silentNotifications === true);
      }
      return completed;
    },
  );

  if (!locked.ran) {
    // Another cycle or an execution holds the plan. Skipping is right: the
    // condition, if real, is still there on the next sweep.
    const busy = skip("recommendation busy");
    await recordCycle({
      trigger,
      verdict: "skipped",
      evidenceHash: null,
      detail: busy.detail,
      evidence: {},
      decisionTrace: {},
      completeClaim: false,
    });
    return busy;
  }
  const completed = locked.result!;
  if (completed.verdict === "skipped") {
    await recordCycle({
      trigger,
      verdict: "skipped",
      evidenceHash: null,
      detail: completed.detail,
      evidence: {},
      decisionTrace: {},
      completeClaim: completed.retryable !== true,
    });
  }
  return completed;
}

/**
 * Run the cycles for a sweep's admitted triggers.
 *
 * Sequential on purpose: each cycle is a model call, and the per-recommendation
 * lock would serialize same-plan work anyway.
 */
export async function runReevaluationCycles(
  triggers: ReadonlyArray<{ trigger: ReevaluationTrigger; canonicalId: number }>,
  deps: CycleDeps = {},
): Promise<CycleResult[]> {
  const results: CycleResult[] = [];
  for (const item of triggers) {
    results.push(await runReevaluationCycle(item.trigger, item.canonicalId, deps));
  }
  return results;
}

interface PendingClaimRow {
  recommendation_id: string;
  user_id: number | string;
  symbol: string;
  reason: string;
  detail: string;
  source: string;
  revision_no: number | string | null;
  raised_at: number | string;
  trigger_payload_json: string | null;
}

function pendingTrigger(row: PendingClaimRow): ReevaluationTrigger {
  let payload: Record<string, unknown> = {};
  try {
    payload = row.trigger_payload_json
      ? (JSON.parse(row.trigger_payload_json) as Record<string, unknown>)
      : {};
  } catch {
    payload = {};
  }
  return {
    recommendationId: row.recommendation_id,
    userId: Number(row.user_id),
    symbol: row.symbol,
    reason: row.reason as ReevaluationReason,
    detail:
      typeof payload.detail === "string" ? payload.detail : row.detail,
    source:
      payload.source === "user" ||
      payload.source === "deep_research" ||
      payload.source === "monitor"
        ? payload.source
        : "tracker",
    revisionNo:
      row.revision_no == null ? null : Number(row.revision_no),
    raisedAt: Number(row.raised_at),
    idempotencyKey:
      typeof payload.idempotencyKey === "string"
        ? payload.idempotencyKey
        : undefined,
  };
}

/**
 * Drain durable claims left by this sweep or an interrupted earlier process.
 *
 * The claim is completed only after a terminal cycle verdict. Busy locks,
 * provider failures, and temporarily incomplete evidence leave it pending, so a
 * user request or deep-research completion cannot disappear between claim and
 * brain invocation.
 */
export async function consumePendingReevaluationTriggers(
  options: { userId?: number; limit?: number } = {},
  deps: CycleDeps = {},
): Promise<CycleResult[]> {
  const limit = Math.max(1, Math.min(100, options.limit ?? 25));
  const rows = options.userId == null
    ? await query<PendingClaimRow>(
        `SELECT recommendation_id, user_id, symbol, reason, detail, source,
                revision_no, raised_at, trigger_payload_json
           FROM recommendation_reevaluations
          WHERE outcome = 'cycle_requested' AND completed_at IS NULL
          ORDER BY COALESCE(claimed_at, raised_at) ASC
          LIMIT ?`,
        [limit],
      )
    : await query<PendingClaimRow>(
        `SELECT recommendation_id, user_id, symbol, reason, detail, source,
                revision_no, raised_at, trigger_payload_json
           FROM recommendation_reevaluations
          WHERE outcome = 'cycle_requested' AND completed_at IS NULL
            AND user_id = ?
          ORDER BY COALESCE(claimed_at, raised_at) ASC
          LIMIT ?`,
        [options.userId, limit],
      );

  const work: Array<{ trigger: ReevaluationTrigger; canonicalId: number }> = [];
  for (const row of rows) {
    const canonical = await query<{ id: number | string }>(
      `SELECT id FROM recommendations
        WHERE user_id = ?
          AND (legacy_tracking_id = ? OR CAST(id AS TEXT) = ?)
        LIMIT 1`,
      [row.user_id, row.recommendation_id, row.recommendation_id],
    );
    const canonicalId = Number(canonical[0]?.id);
    if (Number.isFinite(canonicalId) && canonicalId > 0) {
      work.push({ trigger: pendingTrigger(row), canonicalId });
    }
  }
  return runReevaluationCycles(work, deps);
}
