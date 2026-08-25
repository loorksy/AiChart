/**
 * Deterministic recommendation status evaluation — NO LLM, NO execution.
 * Walks complete candles strictly after the creation candle and updates the
 * lifecycle status + outcome from OHLC only.
 *
 * Policies (documented on purpose — we never fake precision):
 * - The creation candle never triggers/SLs the recommendation.
 * - The FILL RULE is part of the plan, not an assumption here: a market entry
 *   starts triggered, a touch entry fills when price reaches its level, a
 *   confirmation_close entry fills at the confirming candle's CLOSE, and a
 *   retest_zone entry fills on a return into its band. Grading a close-armed
 *   plan as if it filled on a touch is the incident entrySemantics.ts records.
 * - Everything downstream reads `effectiveEntry` — the price the plan is
 *   actually graded on — never the nominal level.
 * - Same-candle SL + TP after entry is AMBIGUOUS from OHLC alone: we resolve
 *   SL-first (risk honesty) when no TP had been reached before that candle. If a
 *   TP had already been reached earlier, the trade closes at that banked TP.
 * - Reaching a TP then later hitting SL/expiry closes the trade as a partial win
 *   at the highest TP reached (win_tp{n}); SL/expiry before any TP is a loss/expiry.
 * - Terminal records (outcome !== "pending") are never re-evaluated.
 */
import { normalizeStoredEntryType, resolveFill } from "./entrySemantics";
import type {
  TrackedDirection,
  TrackedRecommendation,
  TrackedRecommendationOutcome,
  TrackedRecommendationStatus,
} from "./types";
import { isTerminalOutcome } from "./types";
import {
  createActivationEvaluator,
  type ActivationEvidence,
} from "./activationRule";

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
    | "effectiveEntry"
    | "retestZone"
    | "stopLoss"
    | "targets"
    | "invalidationLevel"
    | "status"
    | "outcome"
    | "createdAt"
    | "createdCandleTime"
    | "expiresAt"
    | "validityCandles"
    | "triggeredAt"
    | "tp1HitAt"
    | "tp2HitAt"
    | "tp3HitAt"
    | "activationRule"
  >;
  candles: TrackerCandle[];
  /**
   * Candles of the ACTIVATION RULE's own timeframe, when it differs from the
   * plan's. A 15m close-below rule on a 5m plan must be graded on 15m closes —
   * grading it on 5m candles satisfies a condition the operator never stated.
   * When present, the rule is replayed over THIS series and the fill loop only
   * opens after the qualifying rule candle has CLOSED (`time + activationBarMs`).
   */
  activationCandles?: TrackerCandle[];
  /** Bar duration of `activationCandles` in ms — converts open time → close time. */
  activationBarMs?: number;
  /**
   * Price-unit band for touch fills (see entrySemantics.entryFillTolerance).
   * A candle that comes within this margin of a `limit_touch` entry fills the
   * plan at the nearest traded price. Omitted = exact-touch grading, which is
   * the pre-tolerance behaviour and what replay tests pin.
   */
  entryTolerance?: number;
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
  /** Proof of WHICH candle satisfied a structured activation rule, for audit. */
  activationEvidence?: ActivationEvidence;
  /**
   * The plan expired because price ran to TP1 WITHOUT the entry ever filling —
   * the opportunity happened and the plan watched it go by. Distinguished from
   * a plain time expiry so the operator hears "فاتت الفرصة" instead of a
   * silent pending card that never resolves (the XAUUSD conditional-sell
   * incident: the market did exactly what the plan predicted and the plan
   * stayed "بانتظار الشرط" forever).
   */
  missedWithoutFill?: boolean;
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
  /** The price the plan is graded on — the fill, never the nominal level. */
  let effectiveEntry: number = r.effectiveEntry ?? r.entry;
  /** True once the activation rule was satisfied on an EARLIER candle. */
  let armedBefore = false;
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

  // Built once per evaluation and fed candles in order: the conditions worth
  // stating are sequences (a break THEN a return THEN a confirmation), which a
  // per-candle predicate cannot express. An already-triggered plan needs none.
  const activation =
    !triggered && r.activationRule ? createActivationEvaluator(r.activationRule) : null;
  let activationEvidence: ActivationEvidence | undefined;

  // Cross-timeframe rules: replay the rule over ITS OWN series up front. The
  // fill loop below then gates on the resulting timestamp instead of feeding
  // the evaluator plan-timeframe candles it was never written about.
  const crossTf = Boolean(activation && input.activationCandles && input.activationBarMs);
  let activationReadyAt: number | null = null;
  if (activation && crossTf) {
    const ruleCandles = [...input.activationCandles!]
      .filter((c) => c.time > r.createdCandleTime)
      .sort((a, b) => a.time - b.time);
    for (const candle of ruleCandles) {
      if (activation.observe(candle).activated) {
        // The condition is only knowable once the qualifying candle CLOSED.
        activationReadyAt = candle.time + input.activationBarMs!;
        break;
      }
    }
  }

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
    activationEvidence,
  });

  let elapsedCandles = 0;
  for (const candle of candles) {
    elapsedCandles += 1;
    if (!triggered) {
      // Candle-count validity (plan §7 B.7): an untriggered plan is only
      // meaningful for the number of candles the contract gave it. Checked
      // alongside wall-clock expiry, per candle so the expiry lands on the
      // candle that overran the budget, not on whenever the sweep next runs.
      // Once triggered, SL/TP govern — a live position does not "expire".
      if (r.validityCandles != null && r.validityCandles > 0 && elapsedCandles > r.validityCandles) {
        return {
          ...finalize("expired", "expired"),
          expiredAt: candle.time,
        };
      }
      // A plan carrying a structured activation rule must have that rule
      // satisfied BEFORE its entry can fill. Without this gate a plan whose
      // condition demanded a close, a confirmed break, a retest or a rejection
      // filled on the first wick that grazed the entry — satisfying none of
      // them. The rule gates; the entry still has to be reached to fill.
      const conditionMet = activation
        ? crossTf
          ? activationReadyAt != null && candle.time >= activationReadyAt
          : activation.observe(candle).activated
        : true;
      const fill = resolveFill({
        plan: {
          direction: dir,
          // Legacy rows spell a pending limit "limit"/"pending"; both fill on a
          // touch, which is what those plans were always graded as.
          entryType: normalizeStoredEntryType(r.entryType),
          entry: r.entry,
          retestZone: r.retestZone ?? null,
        },
        candle,
        conditionMet,
        armedBefore,
        tolerance: input.entryTolerance,
      });
      if (conditionMet) armedBefore = true;
      if (fill.filled) {
        triggered = true;
        triggeredAt = candle.time;
        // A confirmation_close plan is graded on the confirming candle's close,
        // not on the nominal trigger level — see entrySemantics.ts.
        if (fill.effectiveEntry != null) effectiveEntry = fill.effectiveEntry;
        activationEvidence = activation?.evidence;
      } else {
        // Missed-opportunity detection: price reached TP1 while the plan was
        // still waiting for its entry/condition. The move the plan predicted
        // has happened WITHOUT it — waiting longer is hoping the market gives
        // the same opportunity twice. Terminal now, announced as missed.
        const tp1 = targets[0];
        if (tp1 != null && tpReached(dir, candle, tp1)) {
          return {
            ...finalize("expired", "expired"),
            expiredAt: candle.time,
            missedWithoutFill: true,
          };
        }
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
    activationEvidence,
  };
}
