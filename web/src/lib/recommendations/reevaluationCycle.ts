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
import { execute } from "@/lib/db";
import { withLock } from "@/lib/locks";
import { createLogger } from "@/lib/logger";
import { metrics } from "@/lib/metrics";
import { FEATURES } from "@/lib/agent/featureFlags";
import { runUnifiedChartAgent } from "@/lib/agent/orchestrator";
import type { AgentFinalResult } from "@/lib/agent/types";
import {
  applyRecommendationRevision,
  evidenceFingerprint,
  getEffectiveRevision,
  type RecommendationRevision,
} from "./canonical/revisions";
import { getCanonicalRecommendation } from "./canonical/repository";
import { manageOpenTradeAfterRevision } from "./tradeManagement";
import type { ReevaluationTrigger } from "./reevaluationTriggers";

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
}

/** How the brain is reached. Injectable so tests exercise the real comparison. */
export interface CycleDeps {
  runBrain?: (input: {
    symbol: string;
    interval: string;
    userId: number;
    reason: string;
  }) => Promise<AgentFinalResult | null>;
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
}): Promise<AgentFinalResult | null> {
  return runUnifiedChartAgent({
    userMessage: `أعِد تقييم ${input.symbol} على ${input.interval}: ${input.reason}`,
    chartContext: { symbol: input.symbol, interval: input.interval },
    requestContext: {
      requestId: `reeval-${input.symbol}-${Date.now()}`,
      userId: input.userId,
      emitActivity: () => {},
    },
    canExecute: false,
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
  stopLoss: number | null;
  targets: number[];
  validityCandles: number | null;
  alternativeScenario: string | null;
}

function comparableFromResult(result: AgentFinalResult): ComparableDecision | null {
  const rec = result.recommendation;
  if (!rec || (rec.action !== "buy" && rec.action !== "sell")) return null;
  return {
    direction: rec.action,
    planType: rec.planType ?? null,
    entry: rec.entry ?? null,
    stopLoss: rec.stop_loss ?? null,
    targets: rec.targets ?? [],
    validityCandles: rec.validityCandles ?? null,
    alternativeScenario: rec.alternativeScenario ?? null,
  };
}

function comparableFromRevision(revision: RecommendationRevision): ComparableDecision {
  return {
    direction: revision.direction,
    planType: revision.planType,
    entry: revision.entry,
    stopLoss: revision.stopLoss,
    targets: revision.targets,
    validityCandles: revision.validityCandles,
    alternativeScenario: revision.alternativeScenario,
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
  return { changed: fields.length > 0, fields };
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
}): Promise<void> {
  await execute(
    `INSERT INTO recommendation_reevaluations
       (recommendation_id, user_id, symbol, reason, detail, source, revision_no,
        outcome, raised_at, dedupe_key, evidence_hash)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)
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
      Date.now(),
      `${input.trigger.revisionNo ?? 0}:${input.trigger.reason}:${input.verdict}`,
      input.evidenceHash,
    ],
  ).catch((error: unknown) => {
    log.warn("failed to record re-evaluation cycle", {
      recommendationId: input.trigger.recommendationId,
      error: error instanceof Error ? error.message : String(error),
    });
  });
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
  const skip = (detail: string): CycleResult => ({
    recommendationId: trigger.recommendationId,
    canonicalId,
    verdict: "skipped",
    revision: null,
    evidenceHash: null,
    detail,
    trigger,
  });

  if (!FEATURES.reevaluationTriggersV1()) {
    return skip("phase disabled");
  }

  const locked = await withLock(
    `reevaluation:${canonicalId}`,
    120_000,
    async (): Promise<CycleResult> => {
      const rec = await getCanonicalRecommendation(trigger.userId, canonicalId);
      if (!rec) return skip("recommendation not found");
      // A finished plan is history, not a draft. Re-deciding it would produce a
      // revision the state machine correctly refuses.
      if (rec.status === "sl_hit" || rec.status === "expired" || rec.status === "cancelled") {
        return skip(`terminal status ${rec.status}`);
      }

      const effective = await getEffectiveRevision(trigger.userId, canonicalId);
      if (!effective) return skip("no effective revision to compare against");

      // The whole bundle, from the same brain, on fresh market data.
      const runBrain = deps.runBrain ?? defaultRunBrain;
      const result = await runBrain({
        symbol: rec.symbol,
        interval: rec.timeframe,
        userId: trigger.userId,
        reason: trigger.detail,
      });
      if (!result) return skip("brain produced no decision");

      const after = comparableFromResult(result);
      if (!after) {
        // An operational blocker is not a verdict about the plan. Saying nothing
        // is correct: the previous decision stands until it can be re-examined.
        return skip("no decision in result (operational blocker)");
      }

      const evidenceHash = evidenceFingerprint({
        dimensions: result.evidenceDimensions ?? null,
        decisionTrace: result.decisionTrace ?? null,
      });
      const before = comparableFromRevision(effective);
      const { changed, fields } = decisionChanged(before, after);

      metrics.reevaluationCycles.inc({ reason: trigger.reason });

      if (!changed) {
        const detail = `${rec.symbol}: أُعيد التقييم بعد ${trigger.reason} والقرار لم يتغيّر — النسخة ${effective.revisionNo} قائمة.`;
        await recordCycle({ trigger, verdict: "confirmed", evidenceHash, detail });
        metrics.reevaluationVerdicts.inc({ verdict: "confirmed" });
        return {
          recommendationId: trigger.recommendationId,
          canonicalId,
          verdict: "confirmed",
          revision: null,
          evidenceHash,
          detail,
          trigger,
        };
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
          stopLoss: after.stopLoss,
          targets: after.targets,
          activationCondition: result.recommendation?.triggerCondition ?? null,
          invalidationRule: result.recommendation?.invalidationRule ?? null,
          alternativeScenario: after.alternativeScenario,
          validityCandles: after.validityCandles,
          reason: `إعادة تقييم (${trigger.reason}): تغيّر ${fields.join("، ")}.`,
          source: "market_update",
          evidence: {
            evidenceDimensions: result.evidenceDimensions ?? null,
            trigger: { reason: trigger.reason, detail: trigger.detail },
          },
          decisionTrace: (result.decisionTrace ?? null) as Record<string, unknown> | null,
        },
      });

      const verdict: CycleVerdict =
        result.recommendation?.executionState === "invalidated" ? "invalidated" : "revised";
      const detail = `${rec.symbol}: أُعيد التقييم بعد ${trigger.reason} — تغيّر ${fields.join("، ")} (النسخة ${revision.revisionNo}).`;
      await recordCycle({ trigger, verdict, evidenceHash, detail });
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

      return {
        recommendationId: trigger.recommendationId,
        canonicalId,
        verdict,
        revision,
        evidenceHash,
        detail,
        trigger,
      };
    },
  );

  if (!locked.ran) {
    // Another cycle or an execution holds the plan. Skipping is right: the
    // condition, if real, is still there on the next sweep.
    return skip("recommendation busy");
  }
  return locked.result!;
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
