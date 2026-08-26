/**
 * The recommendation's event TIMELINE — every fact of its life, in order,
 * derived purely from persisted fields. Pure and deterministic: the same
 * stored record always yields the same timeline, so the mini strip on a card
 * and the full ledger on the detail page can never disagree.
 *
 * This is a projection, not a store: the authoritative facts live in the
 * canonical tables (transitions, outcomes) and on the tracked row (timestamps,
 * the sweep's measurements). The API layer may enrich an event's `detail` from
 * a transition's recorded reason (e.g. WHICH candle satisfied the activation
 * rule); this module owns the skeleton those details hang on.
 */
import type { TrackedRecommendation } from "./types";

export type TimelineEventType =
  | "issued"
  | "activated"
  | "tp1_hit"
  | "tp2_hit"
  | "tp3_hit"
  | "stop_breach_survived"
  | "stopped"
  | "expired"
  | "missed_opportunity"
  | "invalidated"
  | "superseded"
  | "cancelled";

export interface RecommendationTimelineEvent {
  type: TimelineEventType;
  at: number;
  /** The price the event happened at, when the record knows it. */
  price: number | null;
  /** The R at this event (banked target R, realized exit R), when known. */
  r: number | null;
  /** Aggregated occurrences (stop-breach survivals). */
  count?: number;
  /** Operator-facing enrichment attached by the API layer (never derived here). */
  detail?: string | null;
}

/** Stable ordering for events that share a timestamp. */
const TYPE_ORDER: Record<TimelineEventType, number> = {
  issued: 0,
  activated: 1,
  tp1_hit: 2,
  tp2_hit: 3,
  tp3_hit: 4,
  stop_breach_survived: 5,
  stopped: 6,
  missed_opportunity: 7,
  expired: 8,
  invalidated: 9,
  superseded: 10,
  cancelled: 11,
};

type TimelineSource = Pick<
  TrackedRecommendation,
  | "direction"
  | "entry"
  | "effectiveEntry"
  | "stopLoss"
  | "targets"
  | "outcome"
  | "createdAt"
  | "expiresAt"
  | "priceAtCreation"
  | "triggeredAt"
  | "tp1HitAt"
  | "tp2HitAt"
  | "tp3HitAt"
  | "slHitAt"
  | "invalidatedAt"
  | "cancelledAt"
  | "expiredAt"
  | "exitPrice"
  | "exitAt"
  | "realizedR"
  | "stopBreachSurvivedCount"
  | "lastStopBreachSurvivedAt"
  | "missedWithoutFill"
  | "supersededAt"
>;

function finite(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

const round2 = (x: number): number => Math.round(x * 100) / 100;

export function buildRecommendationTimeline(
  rec: TimelineSource,
): RecommendationTimelineEvent[] {
  const events: RecommendationTimelineEvent[] = [];
  const entry = finite(rec.effectiveEntry) ?? rec.entry;
  const risk = Math.abs(entry - rec.stopLoss);
  const rTo = (price: number | null): number | null =>
    price == null || !(risk > 0)
      ? null
      : round2(
          (rec.direction === "buy" ? price - entry : entry - price) / risk,
        );

  events.push({
    type: "issued",
    at: rec.createdAt,
    price: finite(rec.priceAtCreation),
    r: null,
  });

  const triggeredAt = finite(rec.triggeredAt);
  if (triggeredAt != null) {
    events.push({
      type: "activated",
      at: triggeredAt,
      price: entry,
      r: null,
    });
  }

  const tps: Array<[TimelineEventType, number | null, number | null]> = [
    ["tp1_hit", finite(rec.tp1HitAt), finite(rec.targets[0])],
    ["tp2_hit", finite(rec.tp2HitAt), finite(rec.targets[1])],
    ["tp3_hit", finite(rec.tp3HitAt), finite(rec.targets[2])],
  ];
  for (const [type, at, target] of tps) {
    if (at != null) {
      events.push({ type, at, price: target, r: rTo(target) });
    }
  }

  const breachAt = finite(rec.lastStopBreachSurvivedAt);
  if (breachAt != null && (rec.stopBreachSurvivedCount ?? 0) > 0) {
    events.push({
      type: "stop_breach_survived",
      at: breachAt,
      price: rec.stopLoss,
      r: null,
      count: rec.stopBreachSurvivedCount ?? 1,
    });
  }

  const realized = finite(rec.realizedR);
  const slHitAt = finite(rec.slHitAt);
  if (slHitAt != null && (rec.outcome === "loss" || rec.outcome.startsWith("win_"))) {
    // A stop after a banked target still HAPPENED — the timeline shows it even
    // though the record closes at the target (the evaluator's own policy).
    events.push({
      type: "stopped",
      at: slHitAt,
      price:
        rec.outcome === "loss"
          ? (finite(rec.exitPrice) ?? rec.stopLoss)
          : rec.stopLoss,
      r: rec.outcome === "loss" ? realized : null,
    });
  }

  if (rec.outcome === "expired") {
    const at = finite(rec.expiredAt) ?? finite(rec.exitAt) ?? rec.expiresAt;
    if (rec.missedWithoutFill && triggeredAt == null) {
      events.push({ type: "missed_opportunity", at, price: null, r: null });
    } else {
      events.push({
        type: "expired",
        at,
        price: triggeredAt != null ? finite(rec.exitPrice) : null,
        r: triggeredAt != null ? realized : null,
      });
    }
  }

  const invalidatedAt = finite(rec.invalidatedAt);
  if (rec.outcome === "invalidated" && invalidatedAt != null) {
    events.push({
      type: "invalidated",
      at: invalidatedAt,
      price: finite(rec.exitPrice),
      r: triggeredAt != null ? realized : null,
    });
  }

  const cancelledAt = finite(rec.cancelledAt);
  if (rec.outcome === "cancelled" && cancelledAt != null) {
    events.push({
      type: rec.supersededAt ? "superseded" : "cancelled",
      at: cancelledAt,
      price: null,
      r: null,
    });
  }

  return events.sort((a, b) => a.at - b.at || TYPE_ORDER[a.type] - TYPE_ORDER[b.type]);
}
