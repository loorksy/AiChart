/**
 * Deterministic recommendation status evaluation — NO LLM, NO execution.
 * Walks complete candles strictly after the creation candle and updates the
 * lifecycle status + outcome from OHLC only.
 *
 * Policies (documented on purpose — we never fake precision):
 * - The creation candle never triggers/SLs the recommendation.
 * - A market entry starts triggered; a limit/pending entry triggers on touch.
 * - Same-candle SL + TP after entry is AMBIGUOUS from OHLC alone: we resolve
 *   SL-first (risk honesty) when no TP had been reached before that candle. If a
 *   TP had already been reached earlier, the trade closes at that banked TP.
 * - Reaching a TP then later hitting SL/expiry closes the trade as a partial win
 *   at the highest TP reached (win_tp{n}); SL/expiry before any TP is a loss/expiry.
 * - Terminal records (outcome !== "pending") are never re-evaluated.
 */
import type {
  TrackedDirection,
  TrackedRecommendation,
  TrackedRecommendationOutcome,
  TrackedRecommendationStatus,
} from "./types";
import { isTerminalOutcome } from "./types";

export interface TrackerCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface EvaluateInput {
  recommendation: Pick<
    TrackedRecommendation,
    | "direction"
    | "entryType"
    | "entry"
    | "stopLoss"
    | "targets"
    | "invalidationLevel"
    | "status"
    | "outcome"
    | "createdAt"
    | "createdCandleTime"
    | "expiresAt"
    | "triggeredAt"
    | "tp1HitAt"
    | "tp2HitAt"
    | "tp3HitAt"
  >;
  candles: TrackerCandle[];
  now?: number;
}

export interface EvaluateResult {
  status: TrackedRecommendationStatus;
  outcome: TrackedRecommendationOutcome;
  triggered: boolean;
  ambiguous: boolean;
  triggeredAt?: number;
  tp1HitAt?: number;
  tp2HitAt?: number;
  tp3HitAt?: number;
  slHitAt?: number;
  expiredAt?: number;
  changed: boolean;
}

const WIN_BY_TP: Record<1 | 2 | 3, TrackedRecommendationOutcome> = {
  1: "win_tp1",
  2: "win_tp2",
  3: "win_tp3",
};
const STATUS_BY_TP: Record<1 | 2 | 3, TrackedRecommendationStatus> = {
  1: "tp1_hit",
  2: "tp2_hit",
  3: "tp3_hit",
};

function tpReached(dir: TrackedDirection, candle: TrackerCandle, target: number): boolean {
  return dir === "buy" ? candle.high >= target : candle.low <= target;
}
function slReached(dir: TrackedDirection, candle: TrackerCandle, sl: number): boolean {
  return dir === "buy" ? candle.low <= sl : candle.high >= sl;
}
function entryTouched(dir: TrackedDirection, candle: TrackerCandle, entry: number): boolean {
  return dir === "buy" ? candle.low <= entry : candle.high >= entry;
}

export function evaluateRecommendation(input: EvaluateInput): EvaluateResult {
  const r = input.recommendation;
  const now = input.now ?? Date.now();

  const base: EvaluateResult = {
    status: r.status,
    outcome: r.outcome,
    triggered: Boolean(r.triggeredAt) || r.entryType === "market",
    ambiguous: false,
    triggeredAt: r.triggeredAt,
    tp1HitAt: r.tp1HitAt,
    tp2HitAt: r.tp2HitAt,
    tp3HitAt: r.tp3HitAt,
    changed: false,
  };

  // Terminal records are final.
  if (isTerminalOutcome(r.outcome)) return base;

  const dir = r.direction;
  const targets = r.targets.slice(0, 3);
  const candles = input.candles
    .filter((c) => c.time > r.createdCandleTime)
    .sort((a, b) => a.time - b.time);

  let triggered = base.triggered;
  let triggeredAt = r.triggeredAt ?? (r.entryType === "market" ? r.createdAt : undefined);
  let highestTp: 0 | 1 | 2 | 3 =
    (r.tp3HitAt && 3) || (r.tp2HitAt && 2) || (r.tp1HitAt && 1) || 0;
  const tpAt: Record<1 | 2 | 3, number | undefined> = {
    1: r.tp1HitAt,
    2: r.tp2HitAt,
    3: r.tp3HitAt,
  };
  let slHitAt: number | undefined;
  let ambiguous = false;

  const finalize = (
    status: TrackedRecommendationStatus,
    outcome: TrackedRecommendationOutcome,
  ): EvaluateResult => ({
    status,
    outcome,
    triggered,
    ambiguous,
    triggeredAt,
    tp1HitAt: tpAt[1],
    tp2HitAt: tpAt[2],
    tp3HitAt: tpAt[3],
    slHitAt,
    changed: true,
  });

  for (const candle of candles) {
    if (!triggered) {
      if (entryTouched(dir, candle, r.entry)) {
        triggered = true;
        triggeredAt = candle.time;
      } else {
        continue; // still waiting for entry — SL/TP do not count pre-trigger
      }
    }

    const sl = slReached(dir, candle, r.stopLoss);
    // Which NEW targets does this candle reach (beyond highestTp)?
    let newHigh: 0 | 1 | 2 | 3 = highestTp;
    for (let i = highestTp; i < targets.length; i++) {
      const t = targets[i];
      if (t != null && tpReached(dir, candle, t)) newHigh = (i + 1) as 1 | 2 | 3;
    }
    const reachedNewTp = newHigh > highestTp;

    if (sl && reachedNewTp) {
      // Same-candle SL + TP → ambiguous. If a TP was already banked, close there;
      // otherwise SL-first for risk honesty.
      ambiguous = true;
      if (highestTp >= 1) {
        slHitAt = candle.time;
        return finalize(STATUS_BY_TP[highestTp as 1 | 2 | 3], WIN_BY_TP[highestTp as 1 | 2 | 3]);
      }
      slHitAt = candle.time;
      return finalize("sl_hit", "loss");
    }

    if (sl) {
      slHitAt = candle.time;
      if (highestTp >= 1) {
        return finalize(STATUS_BY_TP[highestTp as 1 | 2 | 3], WIN_BY_TP[highestTp as 1 | 2 | 3]);
      }
      return finalize("sl_hit", "loss");
    }

    if (reachedNewTp) {
      for (let i = highestTp + 1; i <= newHigh; i++) {
        if (!tpAt[i as 1 | 2 | 3]) tpAt[i as 1 | 2 | 3] = candle.time;
      }
      highestTp = newHigh;
      if (highestTp === 3) {
        return finalize("tp3_hit", "win_tp3");
      }
    }
  }

  // No terminal price event yet. Apply expiry.
  if (now > r.expiresAt) {
    if (highestTp >= 1) {
      return finalize(STATUS_BY_TP[highestTp as 1 | 2 | 3], WIN_BY_TP[highestTp as 1 | 2 | 3]);
    }
    return {
      ...finalize("expired", "expired"),
      expiredAt: now,
    };
  }

  // Still active — reflect the current lifecycle state.
  const status: TrackedRecommendationStatus =
    highestTp >= 1 ? STATUS_BY_TP[highestTp as 1 | 2 | 3] : triggered ? "triggered" : "pending_entry";
  const changed = status !== r.status || triggeredAt !== r.triggeredAt || highestTp > 0;
  return {
    status,
    outcome: "pending",
    triggered,
    ambiguous,
    triggeredAt,
    tp1HitAt: tpAt[1],
    tp2HitAt: tpAt[2],
    tp3HitAt: tpAt[3],
    slHitAt,
    changed,
  };
}
