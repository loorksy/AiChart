/**
 * Re-evaluation triggers (constitution §6, plan §7 B.9).
 *
 * The tracker watches a live plan and notices things that might change it: the
 * structure it was built on breaks, the pattern completes or fails, a release
 * appears on the calendar, the spread widens past the point where the plan still
 * pays, the higher timeframe turns.
 *
 * What it does with that is the whole point. It RAISES A TRIGGER. It does not
 * decide, and it does not touch a level:
 *
 *     tracker detects  →  trigger recorded  →  fresh evidence bundle
 *                      →  the unified brain decides  →  applyRecommendationRevision
 *
 * A trigger is a request for a new decision cycle, and the cycle's output is the
 * only thing that may change the plan. That ordering is what keeps one brain: if
 * the tracker could adjust a stop "because the spread widened", there would be
 * two components deciding, and the second one would be a heuristic with no
 * evidence bundle and no decision trace behind it.
 *
 * Automatic cycles are the operator's benefit, not their expense: they are rate
 * limited and de-duplicated here, and they never bill.
 */
import { execute, query } from "@/lib/db";
import { withLock } from "@/lib/locks";
import { createLogger } from "@/lib/logger";
import { metrics } from "@/lib/metrics";
import { FEATURES } from "@/lib/agent/featureFlags";

const log = createLogger("recommendations:reevaluation");

export type ReevaluationReason =
  /** Market structure that the plan was built on broke or flipped. */
  | "structure_break"
  /** The founding pattern finished forming. */
  | "pattern_completed"
  /** The founding pattern failed or was invalidated. */
  | "pattern_failed"
  /** Spread widened until the plan's net return stopped making sense. */
  | "spread_widened"
  /** A calendar release appeared, or one is now imminent. */
  | "economic_event"
  /** The higher timeframe reversed against the plan. */
  | "higher_timeframe_reversal"
  /** Price is near invalidation and the surrounding picture has changed. */
  | "approaching_invalidation_changed_context"
  /** Deep research returned a verdict. */
  | "deep_research"
  /** The operator asked. */
  | "user_request";

export interface ReevaluationTrigger {
  recommendationId: string;
  userId: number;
  symbol: string;
  reason: ReevaluationReason;
  /** Operator-readable why, stored with the trigger. */
  detail: string;
  /** Which component noticed. Never the decider. */
  source: "tracker" | "deep_research" | "user" | "monitor";
  /** Revision in force when it was raised, so a stale trigger is recognisable. */
  revisionNo: number | null;
  raisedAt: number;
  /** Stable producer identity (for example a deep-analysis id). */
  idempotencyKey?: string;
}

/**
 * Smallest gap between automatic cycles for one recommendation.
 *
 * A decision cycle costs a model call. Without a floor, a plan sitting next to a
 * widening spread would re-decide every sweep and produce a stream of near
 * identical revisions — noise for the operator and cost for nobody's benefit.
 */
export const COOLDOWN_MS = 15 * 60 * 1000;

/** Most automatic cycles one recommendation may cause in its lifetime. */
export const MAX_AUTOMATIC_CYCLES = 6;

/**
 * A trigger the OPERATOR asked for is never rate limited — the limits exist to
 * bound automatic spend, and the operator asking is not automatic.
 */
const EXEMPT_FROM_LIMITS: ReadonlySet<ReevaluationReason> = new Set([
  "user_request",
  "deep_research",
]);

export interface DetectTriggersInput {
  recommendation: {
    id: string;
    userId: number;
    symbol: string;
    direction: "buy" | "sell";
    entry: number;
    stopLoss: number;
    invalidationLevel?: number;
    revisionNo?: number | null;
    /** The pattern the plan was founded on, when it had one. */
    foundingPattern?: string | null;
  };
  /** Live structure read for this sweep. */
  structure?: {
    /** Direction the current structure favours, from the deterministic detector. */
    bias?: "up" | "down" | "flat" | null;
    /** True when a break-of-structure event landed since the last sweep. */
    brokeSinceLastSweep?: boolean | null;
    /** Stable identity of the detected break (normally its candle time). */
    eventKey?: string | null;
  } | null;
  /** Founding pattern's current stage, when the detector still sees it. */
  patternStage?: string | null;
  /** Stable identity of the pattern/stage observation. */
  patternStageKey?: string | null;
  /** Higher-timeframe bias, when the multi-timeframe read ran. */
  higherTimeframeBias?: "up" | "down" | "flat" | null;
  /** Spread now versus what the plan was costed at, both in the same unit. */
  spread?: { now: number; plannedFor: number } | null;
  /** Calendar releases within the plan's horizon. */
  upcomingEvents?: Array<{ title: string; minutesAway: number; impact: string }> | null;
  /** Price is close to invalidation while some surrounding evidence changed. */
  invalidationProximity?: {
    currentPrice: number;
    invalidationLevel: number;
    atr: number;
    contextChanged: boolean;
  } | null;
  now?: number;
}

/**
 * Spread multiple past which the plan's economics are considered broken.
 *
 * Two times what it was costed at: below that the plan is worse, above it the
 * plan is a different trade.
 */
const SPREAD_BREAK_MULTIPLE = 2;

/** Minutes inside which a release is treated as imminent. */
const EVENT_IMMINENT_MINUTES = 30;

function cooldownBucket(timestamp: number): number {
  return Math.floor(timestamp / COOLDOWN_MS);
}

/**
 * Detect what changed. Pure — no reads, no writes, no decisions.
 *
 * Returns the reasons a new decision cycle is warranted. An empty array is the
 * common and correct answer: most sweeps change nothing.
 */
export function detectReevaluationTriggers(
  input: DetectTriggersInput,
): ReevaluationTrigger[] {
  const rec = input.recommendation;
  const now = input.now ?? Date.now();
  const triggers: ReevaluationTrigger[] = [];

  const raise = (
    reason: ReevaluationReason,
    detail: string,
    idempotencyKey?: string,
  ) => {
    triggers.push({
      recommendationId: rec.id,
      userId: rec.userId,
      symbol: rec.symbol,
      reason,
      detail,
      source: "tracker",
      revisionNo: rec.revisionNo ?? null,
      raisedAt: now,
      idempotencyKey,
    });
  };

  // Structure. A break that goes AGAINST the plan is the reason to look again;
  // a break that confirms it is not news.
  if (input.structure?.brokeSinceLastSweep) {
    const against =
      (rec.direction === "buy" && input.structure.bias === "down") ||
      (rec.direction === "sell" && input.structure.bias === "up");
    if (against) {
      raise(
        "structure_break",
        `${rec.symbol}: كسر هيكلي ضد اتجاه الخطة — يستدعي إعادة تقييم.`,
        input.structure.eventKey ?? undefined,
      );
    }
  }

  // The founding pattern resolving either way changes what the plan rests on.
  if (rec.foundingPattern && input.patternStage) {
    if (input.patternStage === "completed" || input.patternStage === "confirmed") {
      raise(
        "pattern_completed",
        `${rec.symbol}: اكتمل ${rec.foundingPattern} الذي بُنيت عليه الخطة.`,
        input.patternStageKey ?? undefined,
      );
    } else if (input.patternStage === "failed" || input.patternStage === "invalidated") {
      raise(
        "pattern_failed",
        `${rec.symbol}: فشل ${rec.foundingPattern} الذي بُنيت عليه الخطة.`,
        input.patternStageKey ?? undefined,
      );
    }
  }

  // Cost. This changes the plan's TYPE and state, never its direction — so the
  // trigger asks for a re-decision rather than editing anything itself.
  if (input.spread && input.spread.plannedFor > 0) {
    const multiple = input.spread.now / input.spread.plannedFor;
    if (multiple >= SPREAD_BREAK_MULTIPLE) {
      raise(
        "spread_widened",
        `${rec.symbol}: السبريد الآن ${multiple.toFixed(1)}× ما كُلّفت به الخطة — الجدوى تغيّرت.`,
        `spread:${multiple.toFixed(1)}:${cooldownBucket(now)}`,
      );
    }
  }

  // Higher timeframe turning against the plan.
  if (input.higherTimeframeBias) {
    const against =
      (rec.direction === "buy" && input.higherTimeframeBias === "down") ||
      (rec.direction === "sell" && input.higherTimeframeBias === "up");
    if (against) {
      raise(
        "higher_timeframe_reversal",
        `${rec.symbol}: انعكس الفريم الأعلى ضد الخطة.`,
        `htf:${input.higherTimeframeBias}:${cooldownBucket(now)}`,
      );
    }
  }

  // Calendar. Absence of a provider produces nothing — never an invented event.
  for (const event of input.upcomingEvents ?? []) {
    if (event.minutesAway <= EVENT_IMMINENT_MINUTES) {
      raise(
        "economic_event",
        `${rec.symbol}: ${event.title} بعد ${Math.max(0, Math.round(event.minutesAway))} دقيقة (${event.impact}).`,
        `event:${event.title}:${event.impact}:${Math.round((now + event.minutesAway * 60_000) / 60_000)}`,
      );
      break; // One trigger per sweep is enough to ask for one cycle.
    }
  }

  const proximity = input.invalidationProximity;
  if (
    proximity &&
    proximity.contextChanged &&
    proximity.atr > 0 &&
    Math.abs(proximity.currentPrice - proximity.invalidationLevel) <=
      proximity.atr * 0.5
  ) {
    raise(
      "approaching_invalidation_changed_context",
      `${rec.symbol}: price is within 0.5 ATR of invalidation and the surrounding evidence changed.`,
      `invalidation-band:0.5atr:${cooldownBucket(now)}`,
    );
  }

  return triggers;
}

interface TriggerRow {
  raised_at: number | string;
  reason: string;
}

function triggerPayload(trigger: ReevaluationTrigger): Record<string, unknown> {
  return {
    reason: trigger.reason,
    detail: trigger.detail,
    source: trigger.source,
    revisionNo: trigger.revisionNo,
    raisedAt: trigger.raisedAt,
    idempotencyKey: trigger.idempotencyKey ?? null,
  };
}

export function reevaluationClaimKey(trigger: ReevaluationTrigger): string {
  const base = `${trigger.revisionNo ?? 0}:${trigger.reason}`;
  return EXEMPT_FROM_LIMITS.has(trigger.reason)
    ? `${base}:${trigger.idempotencyKey ?? `${trigger.raisedAt}:${encodeURIComponent(trigger.detail).slice(0, 80)}`}`
    : `${base}:${trigger.idempotencyKey ?? `window:${cooldownBucket(trigger.raisedAt)}`}`;
}

/**
 * Decide which detected triggers may actually start a cycle.
 *
 * Reads the recommendation's trigger history and applies three limits:
 * de-duplication of the same reason at the same revision, a cooldown between
 * cycles, and a lifetime cap. Operator-initiated reasons bypass all three.
 */
export async function admitTriggers(
  triggers: readonly ReevaluationTrigger[],
): Promise<{ admitted: ReevaluationTrigger[]; suppressed: number }> {
  if (!FEATURES.reevaluationTriggersV1()) {
    return { admitted: [], suppressed: triggers.length };
  }
  if (!triggers.length) return { admitted: [], suppressed: 0 };

  const admitted: ReevaluationTrigger[] = [];
  let suppressed = 0;

  const groups = new Map<string, ReevaluationTrigger[]>();
  for (const trigger of triggers) {
    groups.set(trigger.recommendationId, [
      ...(groups.get(trigger.recommendationId) ?? []),
      trigger,
    ]);
    metrics.reevaluationTriggers.inc({
      reason: trigger.reason,
      outcome: "detected",
    });
  }

  for (const [recommendationId, group] of groups) {
    const locked = await withLock(
      `reevaluation-admission:${recommendationId}`,
      15_000,
      async () => {
        const history = await query<TriggerRow>(
          `SELECT raised_at, reason FROM recommendation_reevaluations
            WHERE recommendation_id = ? AND outcome = 'cycle_requested'
            ORDER BY raised_at DESC LIMIT 50`,
          [recommendationId],
        ).catch(() => []);
        const automatic = history.filter(
          (row) => !EXEMPT_FROM_LIMITS.has(row.reason as ReevaluationReason),
        );
        const lastRaisedAt = automatic.length
          ? Number(automatic[0]!.raised_at)
          : 0;
        let automaticAdmitted = 0;

        for (const trigger of group) {
          const exempt = EXEMPT_FROM_LIMITS.has(trigger.reason);
          const overCap =
            !exempt &&
            automatic.length + automaticAdmitted >= MAX_AUTOMATIC_CYCLES;
          const inCooldown =
            !exempt && trigger.raisedAt - lastRaisedAt < COOLDOWN_MS;
          const extraAutomatic = !exempt && automaticAdmitted >= 1;
          if (overCap || inCooldown || extraAutomatic) {
            suppressed += 1;
            metrics.reevaluationTriggers.inc({
              reason: trigger.reason,
              outcome: "suppressed",
            });
            await recordTrigger(trigger, "suppressed");
            continue;
          }

          const result = await execute(
            `INSERT INTO recommendation_reevaluations
               (recommendation_id, user_id, symbol, reason, detail, source,
                revision_no, outcome, raised_at, dedupe_key,
                trigger_payload_json, claimed_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
             ON CONFLICT (recommendation_id, dedupe_key) DO NOTHING`,
            [
              trigger.recommendationId,
              trigger.userId,
              trigger.symbol,
              trigger.reason,
              trigger.detail,
              trigger.source,
              trigger.revisionNo,
              "cycle_requested",
              trigger.raisedAt,
              reevaluationClaimKey(trigger),
              JSON.stringify(triggerPayload(trigger)),
              Date.now(),
            ],
          );
          if (result.changes > 0) {
            admitted.push(trigger);
            if (!exempt) automaticAdmitted += 1;
            metrics.reevaluationTriggers.inc({
              reason: trigger.reason,
              outcome: "admitted",
            });
          } else {
            suppressed += 1;
            metrics.reevaluationTriggers.inc({
              reason: trigger.reason,
              outcome: "duplicate",
            });
          }
        }
      },
    );
    if (!locked.ran) {
      for (const trigger of group) {
        if (
          EXEMPT_FROM_LIMITS.has(trigger.reason) &&
          (await recordTrigger(trigger, "cycle_requested"))
        ) {
          admitted.push(trigger);
          metrics.reevaluationTriggers.inc({
            reason: trigger.reason,
            outcome: "admitted",
          });
        } else {
          suppressed += 1;
          metrics.reevaluationTriggers.inc({
            reason: trigger.reason,
            outcome: "duplicate",
          });
        }
      }
    }
  }

  return { admitted, suppressed };
}

/**
 * Record a trigger.
 *
 * Stored whether or not a cycle followed, so "why was this re-decided" and "why
 * was this NOT re-decided" are both answerable later. The unique key makes the
 * write idempotent across overlapping sweeps.
 */
export async function recordTrigger(
  trigger: ReevaluationTrigger,
  outcome: "cycle_requested" | "suppressed",
): Promise<boolean> {
  return execute(
    `INSERT INTO recommendation_reevaluations
       (recommendation_id, user_id, symbol, reason, detail, source, revision_no,
        outcome, raised_at, dedupe_key, trigger_payload_json, claimed_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT (recommendation_id, dedupe_key) DO NOTHING`,
    [
      trigger.recommendationId,
      trigger.userId,
      trigger.symbol,
      trigger.reason,
      trigger.detail,
      trigger.source,
      trigger.revisionNo,
      outcome,
      trigger.raisedAt,
      outcome === "cycle_requested"
        ? reevaluationClaimKey(trigger)
        : `suppressed:${trigger.revisionNo ?? 0}:${trigger.reason}:${trigger.raisedAt}`,
      JSON.stringify(triggerPayload(trigger)),
      outcome === "cycle_requested" ? Date.now() : null,
    ],
  )
    .then((result) => result.changes > 0)
    .catch((error: unknown) => {
      // A lost trigger record must not break the sweep; the plan is unchanged
      // either way, since a trigger never edits anything by itself.
      log.warn("failed to record re-evaluation trigger", {
        recommendationId: trigger.recommendationId,
        reason: trigger.reason,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    });
}

/** Trigger history for one recommendation, newest first. */
export async function listTriggers(recommendationId: string): Promise<
  Array<ReevaluationTrigger & { outcome: string }>
> {
  const rows = await query<{
    recommendation_id: string;
    user_id: number | string;
    symbol: string;
    reason: string;
    detail: string;
    source: string;
    revision_no: number | string | null;
    outcome: string;
    raised_at: number | string;
  }>(
    `SELECT recommendation_id, user_id, symbol, reason, detail, source,
            revision_no, outcome, raised_at
       FROM recommendation_reevaluations
      WHERE recommendation_id = ?
      ORDER BY raised_at DESC`,
    [recommendationId],
  ).catch(() => []);
  return rows.map((row) => ({
    recommendationId: row.recommendation_id,
    userId: Number(row.user_id),
    symbol: row.symbol,
    reason: row.reason as ReevaluationReason,
    detail: row.detail,
    source: row.source as ReevaluationTrigger["source"],
    revisionNo: row.revision_no == null ? null : Number(row.revision_no),
    outcome: row.outcome,
    raisedAt: Number(row.raised_at),
  }));
}
