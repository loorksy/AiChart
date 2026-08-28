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
 * - Every take-profit has a TARGET ZONE equal to the entry-fill band
 *   (`targetHitTolerance` ≡ `entryFillTolerance`: gold floor 10, cap 15).
 *   Sell: `low <= target + tol`. Buy: `high >= target - tol`. The honest hit
 *   price is the nearest traded extreme that entered the zone, never the
 *   labeled line if price never printed it. The stop does NOT use this band.
 * - Sequential TPs still sequential: TP2 cannot count unless TP1 already hit.
 * - Terminal records (outcome !== "pending") are never re-evaluated.
 */
import {
  normalizeStoredEntryType,
  resolveFill,
  resolveInvalidationMode,
  resolveTargetHit,
  type InvalidationMode,
} from "./entrySemantics";
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
    | "invalidationMode"
    | "planType"
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
    | "tp1HitPrice"
    | "tp2HitPrice"
    | "tp3HitPrice"
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
   * Price-unit band for touch fills AND take-profit hits (see
   * entrySemantics.entryFillTolerance — the same 10–15 gold helper). A candle
   * that comes within this margin of a `limit_touch` entry fills the plan at
   * the nearest traded price; a candle that comes within this margin of TP1/
   * TP2/TP3 counts that target as reached, also at the nearest traded price.
   * Omitted = exact-touch grading, which is the pre-tolerance behaviour and
   * what replay tests pin. The stop does not use this band.
   */
  entryTolerance?: number;
  /**
   * Price-unit band for every take-profit (TP1, TP2, TP3, …). Same helper as
   * the entry band (`targetHitTolerance` ≡ `entryFillTolerance`) so the two
   * cannot drift. Sell: hit when `low <= target + tol`. Buy: hit when
   * `high >= target - tol`. The stop does NOT use this — invalidation stays
   * exact (close | touch). Omitted falls back to `entryTolerance`, then to
   * exact-touch (replay tests).
   */
  targetTolerance?: number;
  now?: number;
}

export interface EvaluateResult {
  status: TrackedRecommendationStatus;
  outcome: TrackedRecommendationOutcome;
  triggered: boolean;
  ambiguous: boolean;
  /**
   * The honest fill price once triggered — the confirming candle's close for
   * a `confirmation_close` plan, the nearest traded price for a tolerance-band
   * touch. Callers persist this so the record grades what actually filled.
   */
  effectiveEntry?: number;
  triggeredAt?: number;
  tp1HitAt?: number;
  tp2HitAt?: number;
  tp3HitAt?: number;
  /**
   * Honest TP prints: the nearest traded extreme that entered each zone,
   * not the labeled line if price never printed it. Absent until that TP hits.
   */
  tp1HitPrice?: number;
  tp2HitPrice?: number;
  tp3HitPrice?: number;
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

function tpReached(
  dir: TrackedDirection,
  candle: TrackerCandle,
  target: number,
  tolerance: number,
): boolean {
  return resolveTargetHit({ direction: dir, candle, target, tolerance }).reached;
}
/**
 * Did this candle terminate the trade at the stop, under the plan's own
 * invalidation mode? `touch` is any trade at the level (wick included);
 * `close` demands the candle CLOSE beyond it — a wick through the stop with a
 * close back inside is a rejection the plan survives, which is exactly what a
 * close-worded invalidation promised.
 */
function slReached(
  dir: TrackedDirection,
  candle: TrackerCandle,
  sl: number,
  mode: InvalidationMode,
): boolean {
  if (mode === "close") {
    return dir === "buy" ? candle.close <= sl : candle.close >= sl;
  }
  return dir === "buy" ? candle.low <= sl : candle.high >= sl;
}

export function evaluateRecommendation(input: EvaluateInput): EvaluateResult {
  const r = input.recommendation;
  const now = input.now ?? Date.now();

  const base: EvaluateResult = {
    status: r.status,
    outcome: r.outcome,
    triggered: Boolean(r.triggeredAt) || r.entryType === "market",
    ambiguous: false,
    effectiveEntry: r.effectiveEntry ?? undefined,
    triggeredAt: r.triggeredAt,
    tp1HitAt: r.tp1HitAt,
    tp2HitAt: r.tp2HitAt,
    tp3HitAt: r.tp3HitAt,
    tp1HitPrice: r.tp1HitPrice ?? undefined,
    tp2HitPrice: r.tp2HitPrice ?? undefined,
    tp3HitPrice: r.tp3HitPrice ?? undefined,
    changed: false,
  };

  // Terminal records are final.
  if (isTerminalOutcome(r.outcome)) return base;

  const dir = r.direction;
  const targets = r.targets.slice(0, 3);
  // Legacy rows spell a pending limit "limit"/"pending"; both fill on a
  // touch, which is what those plans were always graded as.
  const entryTypeCanonical = normalizeStoredEntryType(r.entryType);
  // The stop's own termination semantics. Stored rows carry it; rows written
  // before the mode existed derive the same default every surface derives —
  // close-confirmed for conditional/pending plans, touch for market fills —
  // so one plan cannot be a rejection survivor here and a stop-out elsewhere.
  const invalidationMode: InvalidationMode =
    r.invalidationMode ??
    resolveInvalidationMode({
      entryType: r.entryType,
      planType: r.planType ?? null,
      activationRule: r.activationRule ?? null,
    });
  const candles = input.candles
    .filter((c) => c.time > r.createdCandleTime)
    .sort((a, b) => a.time - b.time);
  // One band for every TP. Falls back to the entry band so a caller that
  // already passes `entryTolerance` (tracker, chat, Telegram) grades targets
  // the same way without a second argument that could drift.
  const targetTol =
    input.targetTolerance != null && Number.isFinite(input.targetTolerance)
      ? Math.max(0, input.targetTolerance)
      : input.entryTolerance != null && Number.isFinite(input.entryTolerance)
        ? Math.max(0, input.entryTolerance)
        : 0;

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
  const tpPrice: Record<1 | 2 | 3, number | undefined> = {
    1: r.tp1HitPrice ?? undefined,
    2: r.tp2HitPrice ?? undefined,
    3: r.tp3HitPrice ?? undefined,
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
    effectiveEntry: triggered ? effectiveEntry : undefined,
    triggeredAt,
    tp1HitAt: tpAt[1],
    tp2HitAt: tpAt[2],
    tp3HitAt: tpAt[3],
    tp1HitPrice: tpPrice[1],
    tp2HitPrice: tpPrice[2],
    tp3HitPrice: tpPrice[3],
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
          entryType: entryTypeCanonical,
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
        if (tp1 != null && tpReached(dir, candle, tp1, targetTol)) {
          return {
            ...finalize("expired", "expired"),
            expiredAt: candle.time,
            missedWithoutFill: true,
          };
        }
        continue; // still waiting for entry — SL/TP do not count pre-trigger
      }
    }

    // Grading starts WHEN THE POSITION EXISTS, never before. Candles before a
    // persisted fill were pre-trade. The fill candle itself grades for touch
    // fills (the position existed intrabar) but NOT for close fills: a
    // confirmation_close position is born at that candle's CLOSE, after its
    // own high/low already happened. This is the transcript's wick-to-4670 —
    // the candle that confirmed the rejection also wicked through the stop,
    // and grading that wick against a position born at the close called the
    // plan's own proof its death.
    if (triggeredAt != null) {
      if (candle.time < triggeredAt) continue;
      if (candle.time === triggeredAt && entryTypeCanonical === "confirmation_close") {
        continue;
      }
    }

    const sl = slReached(dir, candle, r.stopLoss, invalidationMode);
    // Which NEW targets does this candle reach? Sequential: TP2 cannot count
    // unless TP1 is already (or simultaneously) in its own zone. A break
    // stops the ladder so a far TP whose zone happens to overlap cannot skip.
    let newHigh: 0 | 1 | 2 | 3 = highestTp;
    for (let i = highestTp; i < targets.length; i++) {
      const t = targets[i];
      if (t != null && tpReached(dir, candle, t, targetTol)) {
        newHigh = (i + 1) as 1 | 2 | 3;
      } else {
        break;
      }
    }
    const reachedNewTp = newHigh > highestTp;

    const bankNewTargets = (from: number, to: number): void => {
      for (let i = from; i <= to; i++) {
        const idx = i as 1 | 2 | 3;
        const labeled = targets[i - 1];
        if (!tpAt[idx]) tpAt[idx] = candle.time;
        if (tpPrice[idx] == null && labeled != null) {
          tpPrice[idx] =
            resolveTargetHit({
              direction: dir,
              candle,
              target: labeled,
              tolerance: targetTol,
            }).hitPrice ?? labeled;
        }
      }
    };

    if (sl && reachedNewTp) {
      if (invalidationMode === "close") {
        // NOT ambiguous: the close is definitionally the candle's LAST event,
        // so every intrabar TP touch preceded the stop-confirming close. Bank
        // the touches, then the close terminates the trade at the best TP.
        bankNewTargets(highestTp + 1, newHigh);
        highestTp = newHigh;
        slHitAt = candle.time;
        return finalize(STATUS_BY_TP[highestTp as 1 | 2 | 3], WIN_BY_TP[highestTp as 1 | 2 | 3]);
      }
      // Touch mode: same-candle SL + TP is ambiguous from OHLC alone. If a TP
      // was already banked, close there; otherwise SL-first for risk honesty.
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
      bankNewTargets(highestTp + 1, newHigh);
      highestTp = newHigh;
      if (highestTp === 3 || highestTp === targets.length) {
        return finalize(STATUS_BY_TP[highestTp as 1 | 2 | 3], WIN_BY_TP[highestTp as 1 | 2 | 3]);
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
  const changed =
    status !== r.status ||
    triggeredAt !== r.triggeredAt ||
    highestTp > 0 ||
    (triggered && effectiveEntry !== (r.effectiveEntry ?? r.entry));
  return {
    status,
    outcome: "pending",
    triggered,
    ambiguous,
    effectiveEntry: triggered ? effectiveEntry : undefined,
    triggeredAt,
    tp1HitAt: tpAt[1],
    tp2HitAt: tpAt[2],
    tp3HitAt: tpAt[3],
    tp1HitPrice: tpPrice[1],
    tp2HitPrice: tpPrice[2],
    tp3HitPrice: tpPrice[3],
    slHitAt,
    changed,
    activationEvidence,
  };
}
