/**
 * Post-fill trade MEASUREMENT — pure arithmetic over the same closed candles
 * the evaluator walks. No LLM, no execution, no opinion: this module answers
 * "what did the trade actually do between its fill and its exit", which the
 * lifecycle evaluator (recommendationStatus.ts) deliberately does not — its
 * job is WHAT ended the plan, this module's job is HOW MUCH.
 *
 * Everything is measured from `effectiveEntry` (the honest fill) against the
 * plan's own stop distance, in R units, because prices differ per instrument
 * but one R is one R on every record:
 *
 *  - MFE (max favorable excursion): the furthest price moved FOR the trade
 *    while the position existed. An MFE of +1.8R on a plan that died at -1R
 *    is the single most instructive number a tracking product can show.
 *  - MAE (max adverse excursion): the deepest drawdown the position survived.
 *  - realized R: the R multiple of the actual exit — the banked target for a
 *    win (the evaluator's own partial-win policy), the stop for a touch-mode
 *    loss, the stop-confirming CLOSE for a close-mode loss (which can be
 *    worse than -1R, and pretending otherwise is the -1 lie this replaces),
 *    and the last close before expiry for a timed-out position.
 *  - durations: issue → fill, and fill → exit.
 *  - stop-breach survivals: close-mode candles that wicked through the stop
 *    and closed back inside — the rejection the plan promised to survive,
 *    counted so the record can SHOW it survived rather than merely not dying.
 *
 * Windowing honesty rules (mirroring the evaluator's own):
 *  - a confirmation_close position is born at its fill candle's CLOSE, so
 *    that candle contributes only its close, never its wick;
 *  - on a target exit the favorable excursion is capped at the exit price —
 *    price beyond the target happened after the position was gone;
 *  - in touch mode the adverse excursion is capped at the stop (-1R): any
 *    trade past it would have ended the position.
 *
 * Legacy rows: everything derivable from persisted levels is derived
 * (realized R of a win, grade taxonomy); everything that needs candles the
 * sweep never measured stays null. No fabrication.
 */
import {
  normalizeStoredEntryType,
  resolveInvalidationMode,
  type InvalidationMode,
} from "./entrySemantics";
import type { ActivationRule } from "./activationRule";
import type { TrackerCandle } from "./recommendationStatus";
import type {
  TrackedDirection,
  TrackedRecommendationOutcome,
} from "./types";

/** How the position actually ended — finer than the outcome, coarser than prose. */
export type TradeExitReason =
  | "target" // ran to the final tracked target
  | "stop" // stopped without banking any target
  | "stop_after_target" // partial win: banked a target, then the stop closed the rest
  | "expiry" // timed out while in position
  | "expiry_after_target" // partial win: banked a target, then time ran out
  | "invalidated"
  | "cancelled";

export interface TradeMetrics {
  /** Best price reached while in trade (null when unmeasurable). */
  mfePrice: number | null;
  /** Worst price reached while in trade. */
  maePrice: number | null;
  /** Max favorable excursion in R (≥ 0). */
  mfeR: number | null;
  /** Max adverse excursion in R (≤ 0). */
  maeR: number | null;
  /** The R multiple of the actual exit; terminal records only. */
  realizedR: number | null;
  exitPrice: number | null;
  exitAt: number | null;
  exitReason: TradeExitReason | null;
  /** Issue → fill. Null until the plan fills. */
  timeToActivationMs: number | null;
  /** Fill → exit. Null while the trade is live. */
  timeInTradeMs: number | null;
  /** Close-mode wicks through the stop that closed back inside. */
  stopBreachSurvivedCount: number;
  lastStopBreachSurvivedAt: number | null;
}

export const EMPTY_TRADE_METRICS: TradeMetrics = {
  mfePrice: null,
  maePrice: null,
  mfeR: null,
  maeR: null,
  realizedR: null,
  exitPrice: null,
  exitAt: null,
  exitReason: null,
  timeToActivationMs: null,
  timeInTradeMs: null,
  stopBreachSurvivedCount: 0,
  lastStopBreachSurvivedAt: null,
};

export interface TradeMetricsInput {
  recommendation: {
    direction: TrackedDirection;
    entryType?: string | null;
    entry: number;
    effectiveEntry?: number | null;
    stopLoss: number;
    invalidationMode?: InvalidationMode | null;
    planType?: "immediate" | "anticipatory" | "conditional" | null;
    activationRule?: ActivationRule | null;
    targets: number[];
    outcome: TrackedRecommendationOutcome;
    createdAt: number;
    expiresAt: number;
    triggeredAt?: number | null;
    tp1HitAt?: number | null;
    tp2HitAt?: number | null;
    tp3HitAt?: number | null;
    tp1HitPrice?: number | null;
    tp2HitPrice?: number | null;
    tp3HitPrice?: number | null;
    slHitAt?: number | null;
    invalidatedAt?: number | null;
    cancelledAt?: number | null;
    expiredAt?: number | null;
  };
  /** Complete candles of the plan's timeframe, any order; filtered here. */
  candles: TrackerCandle[];
  now?: number;
}

const round2 = (x: number): number => Math.round(x * 100) / 100;

function finite(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Where and why the trade ended, from the persisted lifecycle timestamps.
 * Mirrors the evaluator's own closing policy: a partial win closes AT the
 * banked target, whatever later killed the remainder. When the target was
 * credited via the 10–15 point zone rather than an exact print, the banked
 * price is the nearest traded extreme (tpNHitPrice), not the labeled line.
 */
function bankedTargetPrice(
  r: TradeMetricsInput["recommendation"],
  n: 1 | 2 | 3,
): number | null {
  const labeled = finite(r.targets[n - 1]);
  const honest =
    n === 1 ? finite(r.tp1HitPrice) : n === 2 ? finite(r.tp2HitPrice) : finite(r.tp3HitPrice);
  // Clamp-style honest print: through/exact is the labeled line (the market
  // traded it); zone-only is the nearest extreme. Either is a real print.
  return honest ?? labeled;
}

function resolveExit(input: TradeMetricsInput): {
  exitAt: number | null;
  exitPrice: number | null;
  exitReason: TradeExitReason | null;
} {
  const r = input.recommendation;
  const now = input.now ?? Date.now();
  const sorted = [...input.candles].sort((a, b) => a.time - b.time);
  const lastCloseAtOrBefore = (t: number): number | null => {
    let close: number | null = null;
    for (const c of sorted) {
      if (c.time > t) break;
      close = c.close;
    }
    return close;
  };

  switch (r.outcome) {
    case "win_tp1":
    case "win_tp2":
    case "win_tp3": {
      const n = r.outcome === "win_tp3" ? 3 : r.outcome === "win_tp2" ? 2 : 1;
      const banked = bankedTargetPrice(r, n);
      const hitAt = n === 3 ? r.tp3HitAt : n === 2 ? r.tp2HitAt : r.tp1HitAt;
      // The last listed target (or TP3) is a full target exit. Anything short
      // of that was the stop or the clock closing the remainder.
      if (n === 3 || n === r.targets.length) {
        return {
          exitAt: hitAt ?? null,
          exitPrice: banked,
          exitReason: "target",
        };
      }
      if (r.slHitAt) {
        return { exitAt: r.slHitAt, exitPrice: banked, exitReason: "stop_after_target" };
      }
      return {
        exitAt: Math.min(now, r.expiresAt),
        exitPrice: banked,
        exitReason: "expiry_after_target",
      };
    }
    case "loss": {
      const exitAt = r.slHitAt ?? null;
      const mode =
        r.invalidationMode ??
        resolveInvalidationMode({
          entryType: r.entryType,
          planType: r.planType ?? null,
          activationRule: r.activationRule ?? null,
        });
      // Touch mode: the stop is an order — it fills AT the stop. Close mode:
      // the position died at the confirming candle's CLOSE, which is beyond
      // the stop; recording -1R there would understate the real loss.
      const exitPrice =
        mode === "close" && exitAt != null
          ? (sorted.find((c) => c.time === exitAt)?.close ?? finite(r.stopLoss))
          : finite(r.stopLoss);
      return { exitAt, exitPrice, exitReason: "stop" };
    }
    case "expired": {
      if (!r.triggeredAt) return { exitAt: r.expiredAt ?? null, exitPrice: null, exitReason: "expiry" };
      const exitAt = r.expiredAt ?? Math.min(now, r.expiresAt);
      return { exitAt, exitPrice: lastCloseAtOrBefore(exitAt), exitReason: "expiry" };
    }
    case "invalidated": {
      const exitAt = r.invalidatedAt ?? null;
      return {
        exitAt,
        exitPrice: exitAt != null && r.triggeredAt ? lastCloseAtOrBefore(exitAt) : null,
        exitReason: "invalidated",
      };
    }
    case "cancelled": {
      const exitAt = r.cancelledAt ?? null;
      return {
        exitAt,
        exitPrice: exitAt != null && r.triggeredAt ? lastCloseAtOrBefore(exitAt) : null,
        exitReason: "cancelled",
      };
    }
    default:
      return { exitAt: null, exitPrice: null, exitReason: null };
  }
}

export function computeTradeMetrics(input: TradeMetricsInput): TradeMetrics {
  const r = input.recommendation;
  const triggeredAt = finite(r.triggeredAt);
  if (triggeredAt == null) {
    // An unfilled plan has no trade to measure — only its clock.
    return { ...EMPTY_TRADE_METRICS };
  }

  const entry = finite(r.effectiveEntry) ?? r.entry;
  const risk = Math.abs(entry - r.stopLoss);
  const dir = r.direction;
  const entryType = normalizeStoredEntryType(r.entryType);
  const mode: InvalidationMode =
    r.invalidationMode ??
    resolveInvalidationMode({
      entryType: r.entryType,
      planType: r.planType ?? null,
      activationRule: r.activationRule ?? null,
    });

  const { exitAt, exitPrice, exitReason } = resolveExit(input);

  /** Signed favorable-direction distance from the fill. */
  const favOf = (price: number): number => (dir === "buy" ? price - entry : entry - price);

  const inTrade = input.candles
    .filter((c) => c.time >= triggeredAt && (exitAt == null || c.time <= exitAt))
    .sort((a, b) => a.time - b.time);

  let bestFav: number | null = null;
  let worstAdv: number | null = null;
  let breaches = 0;
  let lastBreachAt: number | null = null;

  for (const candle of inTrade) {
    // A confirmation_close position is born at the fill candle's CLOSE — its
    // wick already happened before the position existed (the evaluator's own
    // fill-candle exemption, applied to measurement).
    const bornAtClose = candle.time === triggeredAt && entryType === "confirmation_close";
    const hi = bornAtClose ? candle.close : candle.high;
    const lo = bornAtClose ? candle.close : candle.low;

    // Close-mode stop-breach survival: traded through the stop, closed back
    // inside. The exit candle of a close-mode stop closes BEYOND the stop, so
    // it can never satisfy this — no special-casing needed.
    const breached =
      mode === "close" &&
      (dir === "buy"
        ? lo <= r.stopLoss && candle.close > r.stopLoss
        : hi >= r.stopLoss && candle.close < r.stopLoss);
    if (breached) {
      breaches += 1;
      lastBreachAt = candle.time;
    }

    let fav = favOf(dir === "buy" ? hi : lo);
    let adv = favOf(dir === "buy" ? lo : hi);

    // Target exits: price beyond the exit level happened after the position
    // closed — the excursion the trade owned stops at its own exit.
    if (candle.time === exitAt && exitReason === "target" && exitPrice != null) {
      fav = Math.min(fav, favOf(exitPrice));
    }
    // Touch mode: any trade past the stop would have ended the position, so
    // the position never experienced an excursion beyond -1R.
    if (mode === "touch") {
      adv = Math.max(adv, -risk);
    }

    bestFav = bestFav == null ? Math.max(0, fav) : Math.max(bestFav, fav);
    worstAdv = worstAdv == null ? Math.min(0, adv) : Math.min(worstAdv, adv);
  }

  const mfePrice =
    bestFav == null ? null : dir === "buy" ? entry + bestFav : entry - bestFav;
  const maePrice =
    worstAdv == null ? null : dir === "buy" ? entry + worstAdv : entry - worstAdv;

  const toR = (dist: number | null): number | null =>
    dist == null || !(risk > 0) ? null : round2(dist / risk);

  return {
    mfePrice: mfePrice == null ? null : round2(mfePrice),
    maePrice: maePrice == null ? null : round2(maePrice),
    mfeR: toR(bestFav),
    maeR: toR(worstAdv),
    realizedR: exitPrice == null ? null : toR(favOf(exitPrice)),
    exitPrice: exitPrice == null ? null : round2(exitPrice),
    exitAt,
    exitReason,
    timeToActivationMs: Math.max(0, triggeredAt - r.createdAt),
    timeInTradeMs: exitAt == null ? null : Math.max(0, exitAt - triggeredAt),
    stopBreachSurvivedCount: breaches,
    lastStopBreachSurvivedAt: lastBreachAt,
  };
}

const EXIT_REASONS: readonly TradeExitReason[] = [
  "target",
  "stop",
  "stop_after_target",
  "expiry",
  "expiry_after_target",
  "invalidated",
  "cancelled",
];

export function isTradeExitReason(value: unknown): value is TradeExitReason {
  return typeof value === "string" && (EXIT_REASONS as readonly string[]).includes(value);
}

/** The persisted shape of an earlier measurement (stored fields are loose). */
export interface PersistedTradeMetrics {
  mfePrice?: number | null;
  maePrice?: number | null;
  mfeR?: number | null;
  maeR?: number | null;
  realizedR?: number | null;
  exitPrice?: number | null;
  exitAt?: number | null;
  exitReason?: string | null;
  timeInTradeMs?: number | null;
  stopBreachSurvivedCount?: number;
  lastStopBreachSurvivedAt?: number | null;
}

/**
 * Monotone merge with a previously persisted measurement, so a sweep replaying
 * a shorter candle window can only ever ADD information, never lose the
 * excursion an earlier sweep already observed.
 */
export function mergeTradeMetrics(
  previous: PersistedTradeMetrics | null | undefined,
  next: TradeMetrics,
): TradeMetrics {
  if (!previous) return next;
  const prevMfeR = finite(previous.mfeR);
  const prevMaeR = finite(previous.maeR);
  const keepPrevMfe = prevMfeR != null && (next.mfeR == null || prevMfeR > next.mfeR);
  const keepPrevMae = prevMaeR != null && (next.maeR == null || prevMaeR < next.maeR);
  return {
    ...next,
    mfeR: keepPrevMfe ? prevMfeR : next.mfeR,
    mfePrice: keepPrevMfe ? (finite(previous.mfePrice) ?? next.mfePrice) : next.mfePrice,
    maeR: keepPrevMae ? prevMaeR : next.maeR,
    maePrice: keepPrevMae ? (finite(previous.maePrice) ?? next.maePrice) : next.maePrice,
    stopBreachSurvivedCount: Math.max(
      previous.stopBreachSurvivedCount ?? 0,
      next.stopBreachSurvivedCount,
    ),
    lastStopBreachSurvivedAt:
      next.lastStopBreachSurvivedAt ?? finite(previous.lastStopBreachSurvivedAt),
    // A terminal exit persisted earlier is final even if this pass could not
    // re-derive it (e.g. the exit candle aged out of the fetched window).
    exitAt: next.exitAt ?? finite(previous.exitAt),
    exitPrice: next.exitPrice ?? finite(previous.exitPrice),
    exitReason:
      next.exitReason ??
      (isTradeExitReason(previous.exitReason) ? previous.exitReason : null),
    realizedR: next.realizedR ?? finite(previous.realizedR),
    timeInTradeMs: next.timeInTradeMs ?? finite(previous.timeInTradeMs),
  };
}

/**
 * The professional grade taxonomy — finer than the outcome column, derived
 * entirely from persisted facts so legacy rows grade honestly too:
 *
 *   win_tp3                    full win — the final target paid
 *   win_tp2 / win_tp1          partial win — closed at the banked target
 *   loss                       stopped without banking anything
 *   expired_in_profit/_in_loss timed out in position, graded by the exit side
 *   expired_in_trade           timed out in position, exit unmeasured (legacy)
 *   missed_opportunity         TP1 came without a fill — the move went alone
 *   expired_untriggered        never filled, clock ran out
 *   invalidated_before_entry / invalidated_in_trade
 *   superseded                 the agent replaced it with a newer plan
 *   cancelled                  withdrawn
 *   active / pending_entry     not terminal yet
 */
export type RecommendationGrade =
  | "win_tp3"
  | "win_tp2"
  | "win_tp1"
  | "loss"
  | "expired_in_profit"
  | "expired_in_loss"
  | "expired_in_trade"
  | "missed_opportunity"
  | "expired_untriggered"
  | "invalidated_before_entry"
  | "invalidated_in_trade"
  | "superseded"
  | "cancelled"
  | "active"
  | "pending_entry";

export const TERMINAL_GRADES: readonly RecommendationGrade[] = [
  "win_tp3",
  "win_tp2",
  "win_tp1",
  "loss",
  "expired_in_profit",
  "expired_in_loss",
  "expired_in_trade",
  "missed_opportunity",
  "expired_untriggered",
  "invalidated_before_entry",
  "invalidated_in_trade",
  "superseded",
  "cancelled",
];

export interface GradableRecommendation {
  outcome: TrackedRecommendationOutcome;
  triggeredAt?: number | null;
  realizedR?: number | null;
  missedWithoutFill?: boolean | null;
  supersededAt?: number | null;
}

export function gradeRecommendation(rec: GradableRecommendation): RecommendationGrade {
  switch (rec.outcome) {
    case "pending":
      return rec.triggeredAt ? "active" : "pending_entry";
    case "win_tp1":
    case "win_tp2":
    case "win_tp3":
      return rec.outcome;
    case "loss":
      return "loss";
    case "invalidated":
      return rec.triggeredAt ? "invalidated_in_trade" : "invalidated_before_entry";
    case "cancelled":
      return rec.supersededAt ? "superseded" : "cancelled";
    case "expired": {
      if (!rec.triggeredAt) {
        return rec.missedWithoutFill ? "missed_opportunity" : "expired_untriggered";
      }
      const r = finite(rec.realizedR);
      if (r == null) return "expired_in_trade";
      return r >= 0 ? "expired_in_profit" : "expired_in_loss";
    }
  }
}

/** Grades that count as a win/loss for streaks and expectancy. */
export function gradeIsWin(grade: RecommendationGrade): boolean {
  return grade === "win_tp1" || grade === "win_tp2" || grade === "win_tp3";
}
export function gradeIsLoss(grade: RecommendationGrade): boolean {
  return grade === "loss";
}

export interface RealizableRecommendation extends GradableRecommendation {
  entry: number;
  effectiveEntry?: number | null;
  stopLoss: number;
  targets: number[];
  direction?: TrackedDirection;
  tp1HitPrice?: number | null;
  tp2HitPrice?: number | null;
  tp3HitPrice?: number | null;
}

/**
 * The realized R of a terminal record: the persisted measurement when the
 * sweep recorded one, otherwise the honest derivation legacy rows allow —
 * a win closed at its banked target, a loss at its stop (-1R, the touch
 * semantics those rows were always graded under). Anything else is null.
 */
export function realizedROf(rec: RealizableRecommendation): number | null {
  const persisted = finite(rec.realizedR);
  if (persisted != null) return persisted;
  const entry = finite(rec.effectiveEntry) ?? rec.entry;
  const risk = Math.abs(entry - rec.stopLoss);
  if (!(risk > 0)) return null;
  if (rec.outcome === "loss") return -1;
  const n =
    rec.outcome === "win_tp3" ? 3 : rec.outcome === "win_tp2" ? 2 : rec.outcome === "win_tp1" ? 1 : 0;
  if (n === 0) return null;
  const labeled = finite(rec.targets[n - 1]);
  const honest =
    n === 1 ? finite(rec.tp1HitPrice) : n === 2 ? finite(rec.tp2HitPrice) : finite(rec.tp3HitPrice);
  const dir = rec.direction;
  let target = labeled;
  if (honest != null && labeled != null && dir) {
    if (dir === "sell" && honest > labeled) target = honest;
    else if (dir === "buy" && honest < labeled) target = honest;
  } else if (honest != null && labeled == null) {
    target = honest;
  }
  if (target == null) return null;
  return round2(Math.abs(target - entry) / risk);
}

export interface ExitTimeSource {
  exitAt?: number | null;
  slHitAt?: number | null;
  tp3HitAt?: number | null;
  invalidatedAt?: number | null;
  cancelledAt?: number | null;
  expiredAt?: number | null;
  lastCheckedAt?: number | null;
  expiresAt: number;
  createdAt: number;
}

/** Best-known moment a terminal record actually ended, for ordering curves. */
export function exitTimeOf(rec: ExitTimeSource): number {
  return (
    finite(rec.exitAt) ??
    finite(rec.slHitAt) ??
    finite(rec.tp3HitAt) ??
    finite(rec.invalidatedAt) ??
    finite(rec.cancelledAt) ??
    finite(rec.expiredAt) ??
    finite(rec.lastCheckedAt) ??
    Math.min(rec.expiresAt, Date.now())
  );
}
