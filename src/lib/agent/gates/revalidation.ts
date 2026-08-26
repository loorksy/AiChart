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

/** Unknown/absent is treated as market — no leniency by omission. */
function isWaitingEntry(entryType: string | undefined): boolean {
  return Boolean(entryType && WAITING_ENTRY_TYPES.has(entryType));
}

function maxAtrDistanceFor(entryType: string | undefined): number {
  return isWaitingEntry(entryType)
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

export type RevalidationStatus =
  | "ok"
  /** Price outran the written entry; the plan is re-priced, not refused. */
  | "reanchored"
  /** The stop is already hit — the idea is gone, not merely mispriced. */
  | "invalidated"
  /** Every target is behind price — the move happened without us. */
  | "targets_passed"
  | "rr_degraded";

export interface RevalidationVerdict {
  status: RevalidationStatus;
  /** Live RR from the current price — what the operator would actually get. */
  liveRr: number | null;
  distance: number;
  maxDistance: number;
  /**
   * The entry the plan MUST be stored with when price outran the written one.
   *
   * Set only on `reanchored`. The caller has to apply it: passing the gate
   * while persisting the old number would grade the operator against a fill
   * nobody could have got, which is a worse failure than the refusal this
   * replaced.
   */
  reanchoredEntry?: number;
  reasonAr?: string;
}

/**
 * Is the plan's own invalidation level already behind the price it FILLS at?
 *
 * Deliberately checked in BOTH directions, unlike reachability. A buy whose
 * price fell through its stop never tripped the old `movedPast` test — that
 * test only fires when price travels AWAY from the entry — and `minRr` is
 * never set on the platform path (the orchestrator states the doctrine: RR is
 * descriptive evidence, not an acceptance threshold). So nothing at all caught
 * it, and G7 would pass a plan that had already lost.
 */
function stopIsBreached(input: RevalidationInput, fillPrice: number): boolean {
  return input.direction === "buy"
    ? fillPrice <= input.stopLoss
    : fillPrice >= input.stopLoss;
}

/** Targets still in front of the given fill price — the reward not yet spent. */
function reachableTargetsFrom(input: RevalidationInput, fillPrice: number): number[] {
  return input.targets.filter((tp) =>
    input.direction === "buy" ? tp > fillPrice : tp < fillPrice,
  );
}

export function revalidatePlan(input: RevalidationInput): RevalidationVerdict {
  const waiting = isWaitingEntry(input.entryType);
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
  const base = { liveRr, distance, maxDistance };

  // The price this plan would actually be GRADED from. A market plan fills at
  // the live quote, so its stop and targets are measured against the market
  // as it is now. A WAITING plan fills later, at its own entry — its stop and
  // targets are that entry's geometry, and where price happens to sit while
  // the plan waits is the approach, not the trade.
  //
  // Judging a waiting plan by the live price is the incident this fixes
  // (2026-08-26): a conditional XAUUSD breakdown sell — entry 4605.29 below
  // the market, stop 4608.13 just above the entry — was refused as "the stop
  // is already hit" because the live price, 4613, sat above 4608.13. It sat
  // there BY CONSTRUCTION: a breakdown sell is written with the market above
  // its stop, and the stop only starts existing when the fill does (the
  // tracker evaluates SL strictly after activation, recommendationStatus.ts).
  // The side-aware fact for a pending plan is its own geometry — stop behind
  // the entry, targets in front of it — which is exactly what G6 validates.
  const fillPrice = waiting ? input.effectiveEntry : input.currentPrice;

  // 1. The idea is already dead at the price it would fill. For a market plan
  //    that is the live quote — a position opened here has already lost. For a
  //    waiting plan this only fires on broken geometry (stop on the wrong side
  //    of its own entry), which G6 refuses earlier.
  if (stopIsBreached(input, fillPrice)) {
    return {
      ...base,
      status: "invalidated",
      reasonAr: t("ar", "gate.revalidation.invalidated", {
        stopLoss: input.stopLoss.toFixed(2),
      }),
    };
  }

  // 2. Nothing left to make at the fill price. Every target sits behind it,
  //    so the trade would open with its whole reward already spent. A waiting
  //    plan measures this from its own entry: a pullback buy's target may
  //    legitimately sit behind the LIVE price — the plan fills below, at the
  //    dip it was written to catch.
  if (input.targets.length > 0 && reachableTargetsFrom(input, fillPrice).length === 0) {
    return {
      ...base,
      status: "targets_passed",
      reasonAr: t("ar", "gate.revalidation.targets_passed"),
    };
  }

  // 3. Price outran the written entry — RE-PRICE rather than refuse.
  //
  //    This used to be a veto, and it was the single most common reason the
  //    platform answered "no recommendation": the analysis takes tens of
  //    seconds, gold moves, and the level the model wrote is frequently gone
  //    by the time the gate runs. Refusing there threw away a correct read
  //    because of a stale number — the operator was told there was no trade
  //    when what was really true is that there was no trade AT THAT PRICE.
  //
  //    The stop is structural and the entry is opportunistic: the stop marks
  //    where the idea is wrong and does not move because price moved, while
  //    the entry is only ever the best available price for that idea. So the
  //    honest repair is to keep the structure and re-anchor the entry, then
  //    report the reward:risk that actually results — which is worse, because
  //    chasing costs something, and saying so is the point. Steps 1 and 2
  //    above are what keep this from re-pricing into a trade that cannot win.
  const movedPast =
    input.direction === "buy"
      ? input.currentPrice > input.effectiveEntry
      : input.currentPrice < input.effectiveEntry;

  if (movedPast && distance > maxDistance) {
    // A re-anchored plan FILLS AT THE LIVE PRICE (the caller converts it to a
    // market entry), so it must be viable there. For market plans steps 1–2
    // already guaranteed this; for waiting plans they were measured from the
    // plan's own entry, so the live-fill facts are checked here — a re-price
    // into a position that has already lost, or whose reward is already
    // spent, is worse than the refusal it replaces. When the re-price cannot
    // win, the move the plan wanted has ALREADY COMPLETED: that is reported
    // as the stale fact it is, and the caller's reprice loop feeds it back
    // for a freshly-priced plan instead of publishing a refusal.
    if (stopIsBreached(input, input.currentPrice)) {
      return {
        ...base,
        status: "invalidated",
        reasonAr: t("ar", "gate.revalidation.invalidated", {
          stopLoss: input.stopLoss.toFixed(2),
        }),
      };
    }
    if (input.targets.length > 0 && reachableTargetsFrom(input, input.currentPrice).length === 0) {
      return {
        ...base,
        status: "targets_passed",
        reasonAr: t("ar", "gate.revalidation.targets_passed"),
      };
    }
    const params = {
      written: input.effectiveEntry.toFixed(2),
      current: input.currentPrice.toFixed(2),
      distance: distance.toFixed(2),
    };
    return {
      ...base,
      status: "reanchored",
      reanchoredEntry: input.currentPrice,
      reasonAr:
        liveRr != null && input.plannedRr != null
          ? t("ar", "gate.revalidation.reanchored", {
              ...params,
              liveRr: liveRr.toFixed(2),
              plannedRr: input.plannedRr.toFixed(2),
            })
          : t("ar", "gate.revalidation.reanchored_no_rr", params),
    };
  }

  // 4. An RR floor, only where a caller opted into one. The platform path sets
  //    no minRr by doctrine, so this never fires there.
  if (input.minRr != null && liveRr != null && liveRr < input.minRr) {
    return {
      ...base,
      status: "rr_degraded",
      reasonAr: t("ar", "gate.revalidation.rr_degraded", {
        liveRr: liveRr.toFixed(2),
        minRr: String(input.minRr),
      }),
    };
  }

  return { ...base, status: "ok" };
}
