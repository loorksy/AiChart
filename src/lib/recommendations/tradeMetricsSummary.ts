/**
 * The OUTCOME SUMMARY of one tracked recommendation — grade, realized R,
 * excursions, durations — as a pure projection of the persisted record.
 *
 * This is the one place the "what did this plan amount to" numbers are
 * assembled, used verbatim by the detail API, the detail page, and the list
 * cards, so a card and its own detail page can never quote different facts.
 *
 * Legacy honesty: rows the sweep never measured surface exactly what their
 * own levels allow (realizedROf) and null for everything else — the summary
 * never invents an excursion it cannot know.
 */
import {
  exitTimeOf,
  gradeRecommendation,
  realizedROf,
  type RecommendationGrade,
} from "./tradeMetrics";
import type { TrackedRecommendation } from "./types";

export interface TradeMetricsSummary {
  grade: RecommendationGrade;
  /** True once the record is finished (outcome !== pending). */
  terminal: boolean;
  /** The R multiple of the actual exit; null while live or unmeasurable. */
  realizedR: number | null;
  /** Max favorable / adverse excursion in R, when the sweep measured them. */
  mfeR: number | null;
  maeR: number | null;
  /** Issue → fill. Null until the plan fills. */
  timeToActivationMs: number | null;
  /**
   * Fill → exit for terminal records; fill → now for a live position — the
   * caller passes `now` so server and client agree on the reference clock.
   */
  timeInTradeMs: number | null;
  /** How the position ended (tradeMetrics.TradeExitReason), when recorded. */
  exitReason: string | null;
  exitPrice: number | null;
  exitAt: number | null;
  /** Close-mode wicks through the stop the position survived. */
  stopBreachSurvivedCount: number;
}

type SummarySource = Pick<
  TrackedRecommendation,
  | "outcome"
  | "entry"
  | "effectiveEntry"
  | "stopLoss"
  | "targets"
  | "createdAt"
  | "expiresAt"
  | "triggeredAt"
  | "slHitAt"
  | "tp3HitAt"
  | "invalidatedAt"
  | "cancelledAt"
  | "expiredAt"
  | "lastCheckedAt"
  | "mfeR"
  | "maeR"
  | "realizedR"
  | "exitPrice"
  | "exitAt"
  | "exitReason"
  | "timeInTradeMs"
  | "stopBreachSurvivedCount"
  | "missedWithoutFill"
  | "supersededAt"
>;

function finite(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function computeTradeMetricsSummary(
  rec: SummarySource,
  now: number = Date.now(),
): TradeMetricsSummary {
  const terminal = rec.outcome !== "pending";
  const triggeredAt = finite(rec.triggeredAt);
  const persistedTimeInTrade = finite(rec.timeInTradeMs);

  return {
    grade: gradeRecommendation(rec),
    terminal,
    realizedR: terminal ? realizedROf(rec) : null,
    mfeR: finite(rec.mfeR),
    maeR: finite(rec.maeR),
    timeToActivationMs:
      triggeredAt != null ? Math.max(0, triggeredAt - rec.createdAt) : null,
    timeInTradeMs:
      persistedTimeInTrade ??
      (triggeredAt != null
        ? Math.max(0, (terminal ? exitTimeOf(rec) : now) - triggeredAt)
        : null),
    exitReason: typeof rec.exitReason === "string" ? rec.exitReason : null,
    exitPrice: finite(rec.exitPrice),
    exitAt: terminal ? (finite(rec.exitAt) ?? exitTimeOf(rec)) : null,
    stopBreachSurvivedCount: rec.stopBreachSurvivedCount ?? 0,
  };
}

/**
 * The R the position is showing RIGHT NOW at `price` — the live "R so far"
 * on an in-trade card. Null when the plan has not filled or risk is degenerate.
 */
export function liveRSoFar(
  rec: Pick<
    TrackedRecommendation,
    "direction" | "entry" | "effectiveEntry" | "stopLoss" | "triggeredAt" | "outcome"
  >,
  price: number | null | undefined,
): number | null {
  if (rec.outcome !== "pending" || !rec.triggeredAt) return null;
  const p = finite(price);
  if (p == null) return null;
  const entry = finite(rec.effectiveEntry) ?? rec.entry;
  const risk = Math.abs(entry - rec.stopLoss);
  if (!(risk > 0)) return null;
  const fav = rec.direction === "buy" ? p - entry : entry - p;
  return Math.round((fav / risk) * 100) / 100;
}

/**
 * Progress of the live position toward its NEXT untaken target, anchored at
 * the effective entry — the card's progress bar. 0 at entry, 1 at the target,
 * clamped; negative excursion clamps to 0 rather than drawing a backwards bar.
 */
export function progressTowardNextTarget(
  rec: Pick<
    TrackedRecommendation,
    | "direction"
    | "entry"
    | "effectiveEntry"
    | "stopLoss"
    | "targets"
    | "triggeredAt"
    | "outcome"
    | "tp1HitAt"
    | "tp2HitAt"
    | "tp3HitAt"
  >,
  price: number | null | undefined,
): { target: number; targetIndex: 1 | 2 | 3; ratio: number } | null {
  if (rec.outcome !== "pending" || !rec.triggeredAt) return null;
  const p = finite(price);
  if (p == null) return null;
  const hit = [rec.tp1HitAt, rec.tp2HitAt, rec.tp3HitAt];
  let nextIndex = -1;
  for (let i = 0; i < Math.min(3, rec.targets.length); i += 1) {
    if (!hit[i]) {
      nextIndex = i;
      break;
    }
  }
  if (nextIndex < 0) return null;
  const target = finite(rec.targets[nextIndex]);
  if (target == null) return null;
  const entry = finite(rec.effectiveEntry) ?? rec.entry;
  const span = rec.direction === "buy" ? target - entry : entry - target;
  if (!(span > 0)) return null;
  const travelled = rec.direction === "buy" ? p - entry : entry - p;
  return {
    target,
    targetIndex: (nextIndex + 1) as 1 | 2 | 3,
    ratio: Math.max(0, Math.min(1, travelled / span)),
  };
}
