/**
 * What actually changed about a recommendation since the last sweep.
 *
 * The evaluator answers "what is its status now"; this answers "what is worth
 * telling the operator". Those differ: price creeping toward the entry zone, or
 * toward the level that would kill the idea, is not a status change but it is
 * the thing a trader wants to know about — and re-running the same sweep with
 * no market movement must produce nothing at all.
 *
 * Pure and deterministic: same inputs, same events. Delivery, deduplication,
 * and channel preferences belong to the alert layer, not here.
 */
import type { TrackedRecommendation } from "./types";

export type LifecycleEventType =
  | "opportunity_created"
  | "approaching_entry"
  | "activated"
  | "approaching_invalidation"
  | "entry_updated"
  | "scenario_changed"
  /** Price came back to a broken level — the retest an entry may wait for. */
  | "retest_started"
  /** It broke and ran without returning: a retest plan will not fill. */
  | "breakout_no_retest"
  | "tp1_hit"
  | "tp2_hit"
  | "tp3_hit"
  | "sl_hit"
  | "invalidated"
  | "expired"
  | "executed_auto"
  | "execution_skipped";

export interface LifecycleEvent {
  type: LifecycleEventType;
  recommendationId: string;
  symbol: string;
  /** Which revision this event describes — part of the dedupe identity. */
  revisionNo: number | null;
  /** Stable key so the same real change is announced exactly once. */
  dedupeKey: string;
  /** Operator-facing one-liner; the alert layer decides the final format. */
  detail: string;
  /** True for events that end the plan's life. */
  terminal: boolean;
  occurredAt: number;
}

/**
 * How close price must come before "approaching" is worth saying.
 *
 * Expressed in ATR when we have it, because a fixed percentage is either noise
 * on gold or silence on a major. Falls back to a small percentage of price.
 */
export function proximityThreshold(input: {
  atr?: number | null;
  price: number;
  multiplier?: number;
}): number {
  const atr = Number(input.atr);
  const multiplier = input.multiplier ?? 0.75;
  if (Number.isFinite(atr) && atr > 0) return atr * multiplier;
  return Math.abs(input.price) * 0.0015;
}

export interface DeriveEventsInput {
  recommendation: Pick<
    TrackedRecommendation,
    "id" | "symbol" | "direction" | "entry" | "stopLoss" | "invalidationLevel" | "status" | "outcome"
  >;
  previousStatus: TrackedRecommendation["status"];
  nextStatus: TrackedRecommendation["status"];
  currentPrice: number | null;
  atr?: number | null;
  revisionNo?: number | null;
  /** Set when this sweep followed a revision, so the change is announced. */
  revisionJustApplied?: { revisionNo: number; reason: string } | null;
  /**
   * A level the plan expects price to come back to before entering — the break
   * level of the structure it was built on. A retest plan lives or dies on
   * whether price returns here, so the two outcomes are announced separately.
   */
  retestLevel?: number | null;
  /**
   * Furthest price has travelled beyond `retestLevel` since the break, in ATR.
   * Past RETEST_ABANDONED_ATR the move has run and a retest entry will not fill.
   */
  excursionAtr?: number | null;
  now?: number;
}

/**
 * How far past the break level counts as "gone without a retest".
 *
 * Two ATR is the point where waiting for a return stops being a plan and starts
 * being hope: the move has paid a whole target's distance without offering the
 * entry.
 */
export const RETEST_ABANDONED_ATR = 2;

const STATUS_EVENTS: Partial<Record<TrackedRecommendation["status"], LifecycleEventType>> = {
  triggered: "activated",
  tp1_hit: "tp1_hit",
  tp2_hit: "tp2_hit",
  tp3_hit: "tp3_hit",
  sl_hit: "sl_hit",
  invalidated: "invalidated",
  expired: "expired",
};

const TERMINAL_EVENTS = new Set<LifecycleEventType>([
  "tp1_hit",
  "tp2_hit",
  "tp3_hit",
  "sl_hit",
  "invalidated",
  "expired",
]);

/**
 * Derive the events for one sweep.
 *
 * Returns an empty array when nothing meaningful moved — that silence is the
 * feature. Only a real status change, a real revision, or price newly entering
 * a proximity band produces anything.
 */
export function deriveLifecycleEvents(input: DeriveEventsInput): LifecycleEvent[] {
  const rec = input.recommendation;
  const now = input.now ?? Date.now();
  const revisionNo = input.revisionNo ?? null;
  const events: LifecycleEvent[] = [];

  const push = (type: LifecycleEventType, detail: string, keySuffix = "") => {
    events.push({
      type,
      recommendationId: rec.id,
      symbol: rec.symbol,
      revisionNo,
      // Revision is part of the identity: the same plan re-issued at new levels
      // legitimately re-announces, while a re-run of the same state does not.
      dedupeKey: `${rec.id}:${revisionNo ?? 0}:${type}${keySuffix}`,
      detail,
      terminal: TERMINAL_EVENTS.has(type),
      occurredAt: now,
    });
  };

  if (input.revisionJustApplied) {
    push(
      "entry_updated",
      `تحدّثت خطة ${rec.symbol}: ${input.revisionJustApplied.reason}`,
    );
  }

  if (input.nextStatus !== input.previousStatus) {
    const type = STATUS_EVENTS[input.nextStatus];
    if (type) push(type, statusDetail(type, rec.symbol));
  }

  // Proximity only makes sense while the plan is still waiting or running, and
  // only when we actually have a price to compare against.
  const price = Number(input.currentPrice);
  const live = input.nextStatus === "pending_entry" || input.nextStatus === "triggered";
  if (live && Number.isFinite(price) && price > 0) {
    const band = proximityThreshold({ atr: input.atr, price });

    if (input.nextStatus === "pending_entry" && Number.isFinite(rec.entry)) {
      const distance = Math.abs(price - rec.entry);
      if (distance <= band) {
        // Bucketed so drifting around the band does not re-announce every sweep.
        push("approaching_entry", `${rec.symbol}: السعر يقترب من منطقة الدخول (${rec.entry}).`);
      }
    }

    const invalidation = Number(rec.invalidationLevel ?? rec.stopLoss);
    if (Number.isFinite(invalidation) && invalidation > 0) {
      const distance = Math.abs(price - invalidation);
      const beyond =
        rec.direction === "buy" ? price <= invalidation : price >= invalidation;
      if (!beyond && distance <= band) {
        push(
          "approaching_invalidation",
          `${rec.symbol}: السعر يقترب من مستوى الإبطال (${invalidation}).`,
        );
      }
    }
  }

  // Retest tracking. A plan built on a broken level is waiting for one of two
  // things to happen, and the operator needs to hear which: price came back
  // (the entry is live) or price left without it (the plan will not fill).
  const retest = Number(input.retestLevel);
  if (live && Number.isFinite(price) && price > 0 && Number.isFinite(retest) && retest > 0) {
    const band = proximityThreshold({ atr: input.atr, price });
    const excursion = Number(input.excursionAtr ?? 0);
    const returned = Math.abs(price - retest) <= band;

    if (returned && input.nextStatus === "pending_entry") {
      push("retest_started", `${rec.symbol}: السعر عاد لاختبار مستوى الكسر (${retest}).`);
    } else if (
      !returned &&
      Number.isFinite(excursion) &&
      excursion >= RETEST_ABANDONED_ATR &&
      input.nextStatus === "pending_entry"
    ) {
      push(
        "breakout_no_retest",
        `${rec.symbol}: الحركة تجاوزت ${RETEST_ABANDONED_ATR} ATR بعد الكسر دون إعادة اختبار — خطة إعادة الاختبار لن تُنفَّذ.`,
      );
    }
  }

  return events;
}

function statusDetail(type: LifecycleEventType, symbol: string): string {
  switch (type) {
    case "activated":
      return `${symbol}: تحقق شرط التفعيل ودخلت الخطة حيّز التنفيذ.`;
    case "tp1_hit":
      return `${symbol}: تحقق الهدف الأول.`;
    case "tp2_hit":
      return `${symbol}: تحقق الهدف الثاني.`;
    case "tp3_hit":
      return `${symbol}: تحقق الهدف الثالث.`;
    case "sl_hit":
      return `${symbol}: ضُرب وقف الخسارة.`;
    case "invalidated":
      return `${symbol}: أُبطلت الخطة.`;
    case "expired":
      return `${symbol}: انتهت صلاحية الخطة.`;
    case "retest_started":
      return `${symbol}: بدأ اختبار مستوى الكسر.`;
    case "breakout_no_retest":
      return `${symbol}: اخترق وواصل دون إعادة اختبار.`;
    default:
      return symbol;
  }
}
