/**
 * G7 — final live-price revalidation.
 *
 * The last thing before a plan is emitted: fetch a fresh quote and ask whether
 * the plan is still the plan. Analysis takes tens of seconds and gold moves;
 * a recommendation validated only against the price that started the run is a
 * recommendation about the past.
 *
 * Two failure modes, both real:
 *
 *  1. **Unreachable entry.** Price has already travelled past the entry. The
 *     plan describes an opportunity that has been and gone, and the tracker
 *     would sit waiting for a return that the move it predicted has removed
 *     the reason for.
 *  2. **Degraded RR.** Price has moved toward the target, so the same stop and
 *     target now buy a worse ratio. The plan is still possible and no longer
 *     worth taking.
 *
 * Both produce a rewrite or a WAIT — never a quiet emission of the stale plan.
 */
import { t } from "@/lib/i18n";
import { rewardToRisk } from "@/lib/recommendations/entrySemantics";

/**
 * How far price may sit from a MARKET entry, in ATR multiples, and stay reachable.
 *
 * This is a fill-now tolerance: `market` is "filled at the creation quote"
 * (entrySemantics.ts), so the only question is whether the quote has drifted
 * far enough that entering now is no longer the plan that was written.
 */
export const DEFAULT_MAX_ATR_DISTANCE = 0.3;

/**
 * The same bound for a plan that WAITS by design.
 *
 * `limit_touch`, `confirmation_close` and `retest_zone` are all defined as
 * filling later — on a touch, on a confirming close, on a return into a band.
 * For those, an entry sitting away from the live price is not drift, it IS the
 * plan: a demand-zone buy is written BELOW price precisely because it wants the
 * pullback. Judging them by the market tolerance rejected every one of them,
 * and the operator got "no recommendation — price has moved past the entry" on
 * an analysis whose own risk note said, correctly, that the entry was ~20
 * points away and would need a real retrace to reach.
 *
 * Live example (2026-08-24): a conditional XAUUSD buy at a demand zone, six
 * gates passed, killed by G7 at distance 21.30 against maxDistance 2.67 — an
 * ATR of ~8.9, so 2.4 ATR, an entirely ordinary pullback.
 *
 * 4 ATR still refuses a genuinely stale plan (an entry left behind by a regime
 * change measures tens of ATR, not two or three) while letting a normal
 * retrace stand. It is a bound on staleness, not a substitute for the plan's
 * own gates: the activation rule decides when a waiting plan actually arms,
 * and validityCandles decides how long it may wait.
 */
export const WAITING_MAX_ATR_DISTANCE = 4;

/**
 * Entry kinds whose fill is deferred. Only `market` fills at the creation
 * quote; everything else is armed and filled later (see ENTRY_TYPES).
 */
const WAITING_ENTRY_TYPES = new Set([
  "limit_touch",
  "confirmation_close",
  "retest_zone",
]);

function maxAtrDistanceFor(entryType: string | undefined): number {
  // Unknown/absent is treated as market: the stricter of the two, so a plan
  // that never declared its fill rule cannot buy leniency by omission.
  return entryType && WAITING_ENTRY_TYPES.has(entryType)
    ? WAITING_MAX_ATR_DISTANCE
    : DEFAULT_MAX_ATR_DISTANCE;
}

export interface RevalidationInput {
  direction: "buy" | "sell";
  /** The price the plan will be graded on. */
  effectiveEntry: number;
  stopLoss: number;
  targets: number[];
  /** Fresh mid from the live quote, fetched immediately before emitting. */
  currentPrice: number;
  /** ATR on the entry timeframe, price units. */
  atr: number;
  /** The RR the plan promised when it was written. */
  plannedRr?: number;
  /** Minimum RR the plan must still clear. */
  minRr?: number;
  /**
   * The plan's fill rule. Decides which reachability bound applies: a market
   * entry must be fillable NOW, a waiting entry is allowed to sit away from
   * price because waiting is what it does. Absent = treated as market.
   */
  entryType?: string;
  maxAtrDistance?: number;
}

export type RevalidationStatus = "ok" | "unreachable" | "rr_degraded";

export interface RevalidationVerdict {
  status: RevalidationStatus;
  /** Live RR from the current price — what the operator would actually get. */
  liveRr: number | null;
  distance: number;
  maxDistance: number;
  reasonAr?: string;
}

export function revalidatePlan(input: RevalidationInput): RevalidationVerdict {
  const maxAtr = input.maxAtrDistance ?? maxAtrDistanceFor(input.entryType);
  const maxDistance = Math.max(0, input.atr * maxAtr);
  const distance = Math.abs(input.currentPrice - input.effectiveEntry);

  const target = input.targets[0];
  const liveRr =
    target != null
      ? rewardToRisk({
          direction: input.direction,
          entry: input.currentPrice,
          stopLoss: input.stopLoss,
          target,
        })
      : null;

  // Reachability is directional: price moving AWAY from a buy entry (upward)
  // is what removes it. Price moving toward it is the plan working.
  const movedPast =
    input.direction === "buy"
      ? input.currentPrice > input.effectiveEntry
      : input.currentPrice < input.effectiveEntry;

  if (movedPast && distance > maxDistance) {
    return {
      status: "unreachable",
      liveRr,
      distance,
      maxDistance,
      reasonAr: t("ar", "gate.revalidation.unreachable", {
        distance: distance.toFixed(2),
        maxDistance: maxDistance.toFixed(2),
      }),
    };
  }

  if (input.minRr != null && liveRr != null && liveRr < input.minRr) {
    return {
      status: "rr_degraded",
      liveRr,
      distance,
      maxDistance,
      reasonAr: t("ar", "gate.revalidation.rr_degraded", {
        liveRr: liveRr.toFixed(2),
        minRr: String(input.minRr),
      }),
    };
  }

  return { status: "ok", liveRr, distance, maxDistance };
}
