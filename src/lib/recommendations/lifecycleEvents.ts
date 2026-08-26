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
import { t } from "@/lib/i18n";
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
  /** A high-impact calendar release is imminent for the plan's currencies. */
  | "economic_event_near"
  /**
   * A re-evaluation cycle looked again and stood by the plan. Informational and
   * NON-terminal: "the market moved, the agent re-checked, nothing changed" is
   * different information from "nobody looked", and until this existed the two
   * were indistinguishable to the operator.
   */
  | "reevaluation_confirmed"
  | "tp1_hit"
  | "tp2_hit"
  | "tp3_hit"
  /**
   * A close-mode candle wicked THROUGH the stop and closed back inside — the
   * rejection the plan's own invalidation wording promised to survive. Worth
   * announcing because the operator watching the wick sees a stop-out; the
   * record saying "survived, by the plan's own rule" is the whole point of
   * close-confirmed invalidation.
   */
  | "stop_breach_survived"
  | "sl_hit"
  | "invalidated"
  | "expired"
  /**
   * Price ran to TP1 while the plan was still waiting for its entry or
   * activation condition — the predicted move happened without a fill. Ends
   * the plan with an honest "missed" instead of a silent eternal pending.
   */
  | "missed_no_fill"
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
  /** The evaluator flagged this expiry as "TP1 reached without a fill". */
  missedWithoutFill?: boolean | null;
  /**
   * A close-mode stop breach the position survived, NEW since the last sweep
   * (the caller compares against what was already persisted). The candle time
   * is part of the dedupe identity, so each survival announces exactly once.
   */
  stopBreachSurvivedAt?: number | null;
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
  "missed_no_fill",
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
    // An expiry caused by the market running to TP1 without a fill is a
    // different fact than a time expiry — and hearing WHICH one it was is the
    // difference between "the agent contradicted itself" and "the trigger
    // never armed before the move went".
    const type =
      input.nextStatus === "expired" && input.missedWithoutFill
        ? ("missed_no_fill" as const)
        : STATUS_EVENTS[input.nextStatus];
    if (type) push(type, statusDetail(type, rec.symbol));
  }

  // A survived stop breach is not a status change — the status stays
  // triggered — but it is exactly the moment the operator is staring at the
  // chart thinking the plan just died. Keyed by the breach candle's time.
  const breachAt = Number(input.stopBreachSurvivedAt);
  if (Number.isFinite(breachAt) && breachAt > 0) {
    push(
      "stop_breach_survived",
      t("ar", "rec.lifecycle.stop_breach_survived", {
        symbol: rec.symbol,
        stop: String(rec.stopLoss),
      }),
      `:${breachAt}`,
    );
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

/**
 * The birth announcement of a plan (plan §8 C.1).
 *
 * Built here — pure, deterministic — rather than at the call site, so the
 * dedupe identity is fixed in one place: revision 1 IS part of the key, which is
 * what lets the legacy creation alert and the lifecycle path share a single
 * claim instead of racing to announce the same plan twice.
 */
export function opportunityCreatedEvent(input: {
  recommendationId: string;
  symbol: string;
  direction: "buy" | "sell";
  entry?: number | null;
  planType?: string | null;
  /** The revision the plan was born with; defaults to 1, like creation does. */
  revisionNo?: number | null;
  now?: number;
}): LifecycleEvent {
  const revisionNo = input.revisionNo ?? 1;
  const side = input.direction === "sell" ? "بيع" : "شراء";
  const entry = Number(input.entry);
  const where = Number.isFinite(entry) && entry > 0 ? ` — الدخول قرب ${entry}` : "";
  return {
    type: "opportunity_created",
    recommendationId: input.recommendationId,
    symbol: input.symbol,
    revisionNo,
    dedupeKey: `${input.recommendationId}:${revisionNo}:opportunity_created`,
    detail: `${input.symbol}: فرصة ${side} جديدة${where}.`,
    terminal: false,
    occurredAt: input.now ?? Date.now(),
  };
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
    case "missed_no_fill":
      return `${symbol}: تحرك السعر إلى الهدف الأول دون تحقق شرط الدخول — فاتت الفرصة وأُغلقت الخطة.`;
    case "retest_started":
      return `${symbol}: بدأ اختبار مستوى الكسر.`;
    case "breakout_no_retest":
      return `${symbol}: اخترق وواصل دون إعادة اختبار.`;
    default:
      return symbol;
  }
}
