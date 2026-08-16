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

/** How far price may sit from the entry, in ATR(M5) multiples, and stay reachable. */
export const DEFAULT_MAX_ATR_DISTANCE = 0.3;

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
  const maxAtr = input.maxAtrDistance ?? DEFAULT_MAX_ATR_DISTANCE;
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
