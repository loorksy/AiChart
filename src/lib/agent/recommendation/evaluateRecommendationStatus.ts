/**
 * Chat/Telegram follow-up status — a THIN adapter over the canonical evaluator.
 *
 * This file used to re-implement fills and stops locally: entry graded as a
 * bare touch regardless of the plan's fill rule, and the stop graded on any
 * intrabar wick regardless of the plan's invalidation wording. That is how one
 * plan answered "stopped out" in chat while the tracked card said "pending" —
 * the exact contradiction of the XAUUSD conditional-sell transcript. Every
 * grading decision now goes through `evaluateRecommendation`, the same
 * function the sweep runs, with the same tolerance and invalidation semantics.
 * This adapter only maps the session shape in and composes the Arabic reason
 * out.
 */
import {
  isTerminalRecommendationStatus,
  type ActiveRecommendation,
  type RecommendationStatus,
} from "../sessionRecommendation";
import type { AgentMarketContext } from "../marketContext/buildAgentMarketContext";
import {
  evaluateRecommendation,
  type TrackerCandle,
} from "@/lib/recommendations/recommendationStatus";
import {
  entryFillTolerance,
  resolveInvalidationMode,
  type InvalidationMode,
} from "@/lib/recommendations/entrySemantics";
import { activationRuleTimeframe } from "@/lib/recommendations/activationRule";
import { isCandleComplete } from "@/lib/ohlc/candleTime";
import { barDurationMs } from "@/lib/intervals";
import { normalizeCanonicalInterval } from "@/lib/markets/intervals";

export interface RecommendationStatusEvaluation {
  status: RecommendationStatus;
  reason: string;
  priceNow: number;
  triggered: boolean;
  invalidated: boolean;
  hitTarget?: number;
  /** The honest fill price once triggered — what "entered at X" must cite. */
  effectiveEntry?: number;
  /** Signed open P&L in price units from the fill (positive = in profit). */
  pointsFromEntry?: number;
  /** The stop's own termination semantics, so the reply words it correctly. */
  invalidationMode?: InvalidationMode;
}

/** Normalize an epoch value to milliseconds (candle feeds may use seconds). */
function toMs(t: number): number {
  return t < 1_000_000_000_000 ? Math.round(t * 1000) : Math.round(t);
}

function fmt(n: number): string {
  return Number.isFinite(n) ? String(Number(n.toFixed(2))) : "—";
}

function completeCandles(
  candles: ReadonlyArray<{ time: number; open: number; high: number; low: number; close: number }>,
  interval: string,
): TrackerCandle[] {
  // The forming candle must never grade a close-based rule or stop: its
  // "close" is just the last tick, and a live price beyond the stop is not a
  // candle close beyond the stop until the bar actually closes.
  return candles
    .filter((c) => isCandleComplete(toMs(c.time), interval))
    .map((c) => ({
      time: toMs(c.time),
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));
}

export function evaluateRecommendationStatus(input: {
  recommendation: ActiveRecommendation;
  market: AgentMarketContext;
}): RecommendationStatusEvaluation {
  const { recommendation, market } = input;
  const priceNow = market.currentPrice ?? market.currentTfCandles.at(-1)?.close ?? 0;

  // A terminal recommendation is final — never re-evaluate it as active.
  if (isTerminalRecommendationStatus(recommendation.status)) {
    return {
      status: recommendation.status,
      reason: "التوصية في حالة نهائية ولا يُعاد تقييمها.",
      priceNow,
      triggered: recommendation.status !== "pending_entry",
      invalidated: recommendation.status === "invalidated",
    };
  }

  const direction = recommendation.direction;
  const candles = completeCandles(market.currentTfCandles, market.interval);

  // Same flexible-entry band as the canonical tracker: a candle that comes
  // within the tolerance of the entry counts as a touch. Without this, the
  // chat path told the operator "price never touched the entry" while the
  // sweep — grading with the band — had already filled the plan.
  const entryTolerance = entryFillTolerance({
    price: recommendation.entry,
    atr: market.atr,
  });

  // Cross-timeframe activation rules: when the rule names the market context's
  // higher timeframe, grade it on THOSE candles like the sweep does. A rule on
  // a timeframe this context does not carry falls back to plan-TF grading —
  // the sweep remains the authority that fetches the rule's own series.
  const ruleTf = recommendation.activationRule
    ? activationRuleTimeframe(recommendation.activationRule)
    : null;
  const ruleInterval = ruleTf ? normalizeCanonicalInterval(ruleTf) : null;
  const planInterval = normalizeCanonicalInterval(market.interval);
  let activationCandles: TrackerCandle[] | undefined;
  let activationBarMs: number | undefined;
  if (
    ruleInterval &&
    ruleInterval !== planInterval &&
    ruleInterval === normalizeCanonicalInterval(market.higherInterval) &&
    market.higherTfCandles.length
  ) {
    activationCandles = completeCandles(market.higherTfCandles, market.higherInterval);
    activationBarMs = barDurationMs(ruleInterval);
  }

  // Legacy in-session plans carry no fill rule. A plan waiting as
  // pending_entry by definition fills on a touch of its level — defaulting it
  // to "market" would read as instantly entered at creation, which is not
  // what the old touch-graded chat path ever meant.
  const entryType = recommendation.entryType ?? "limit_touch";

  const invalidationMode = resolveInvalidationMode({
    declared: recommendation.invalidationMode,
    entryType,
    planType: recommendation.planType ?? null,
    activationRule: recommendation.activationRule ?? null,
  });

  const alreadyTriggered = recommendation.status !== "pending_entry";
  const result = evaluateRecommendation({
    recommendation: {
      direction,
      entryType,
      entry: recommendation.entry,
      effectiveEntry: recommendation.effectiveEntry,
      retestZone: recommendation.retestZone ?? null,
      stopLoss: recommendation.stopLoss,
      invalidationMode,
      planType: recommendation.planType,
      targets: recommendation.targets,
      invalidationLevel: recommendation.invalidationLevel,
      status: recommendation.status,
      outcome: "pending",
      createdAt: toMs(recommendation.createdAt),
      createdCandleTime: toMs(
        recommendation.createdCandleTime ?? recommendation.createdAt,
      ),
      expiresAt: recommendation.expiresAt ?? Number.POSITIVE_INFINITY,
      validityCandles: recommendation.validityCandles,
      // The stored lifecycle is authoritative for "did it fill": the sweep may
      // have seen candles this context does not carry. Only a pending plan is
      // re-derived from history here.
      triggeredAt: alreadyTriggered
        ? toMs(
            recommendation.triggeredAt ??
              recommendation.createdCandleTime ??
              recommendation.createdAt,
          )
        : undefined,
      tp1HitAt: undefined,
      tp2HitAt: undefined,
      tp3HitAt: undefined,
      activationRule: recommendation.activationRule ?? undefined,
    },
    candles,
    activationCandles,
    activationBarMs,
    entryTolerance,
  });

  const fill =
    result.effectiveEntry ?? recommendation.effectiveEntry ?? recommendation.entry;
  const points = direction === "buy" ? priceNow - fill : fill - priceNow;

  const stopSentence =
    invalidationMode === "close"
      ? `الوقف ${fmt(recommendation.stopLoss)} لا يُضرب إلا بإغلاق شمعة خلفه — الاختراق بالذيل وحده لا يُنهي الصفقة.`
      : `الوقف ${fmt(recommendation.stopLoss)} يعمل باللمس.`;

  switch (result.status) {
    case "sl_hit":
      return {
        status: "sl_hit",
        reason:
          invalidationMode === "close"
            ? "أغلقت شمعة خلف وقف الخسارة بعد تفعيل الدخول — الإغلاق هو ما يُنهي الصفقة وفق شروط الخطة."
            : "تم ضرب وقف الخسارة بعد تفعيل الدخول.",
        priceNow,
        triggered: true,
        invalidated: false,
        effectiveEntry: fill,
        invalidationMode,
      };
    case "invalidated":
      return {
        status: "invalidated",
        reason: recommendation.invalidationRule,
        priceNow,
        triggered: result.triggered,
        invalidated: true,
        invalidationMode,
      };
    case "expired":
      return {
        status: "expired",
        reason: result.missedWithoutFill
          ? "فاتت الفرصة: تحرك السعر نحو الهدف قبل تحقق شرط الدخول، فأُغلقت التوصية دون دخول."
          : "انتهت صلاحية التوصية زمنياً.",
        priceNow,
        triggered: result.triggered,
        invalidated: false,
        invalidationMode,
      };
    case "cancelled":
      return {
        status: "cancelled",
        reason: "أُلغيت التوصية.",
        priceNow,
        triggered: result.triggered,
        invalidated: false,
        invalidationMode,
      };
    case "tp1_hit":
    case "tp2_hit":
    case "tp3_hit": {
      const n = result.status === "tp3_hit" ? 3 : result.status === "tp2_hit" ? 2 : 1;
      return {
        // The session vocabulary has no tp3_hit; 3 targets report as tp2_hit
        // with the honest target number carried in hitTarget.
        status: n === 1 ? "tp1_hit" : "tp2_hit",
        reason: `تحقق الهدف ${n}. الدخول الفعلي كان عند ${fmt(fill)}.`,
        priceNow,
        triggered: true,
        invalidated: false,
        hitTarget: n,
        effectiveEntry: fill,
        invalidationMode,
      };
    }
    case "triggered":
      return {
        status: "triggered",
        reason:
          `دخلت الصفقة عند ${fmt(fill)} وما زالت تحت المتابعة. ` +
          `السعر الحالي ${fmt(priceNow)} (${points >= 0 ? "+" : ""}${fmt(points)} نقطة). ` +
          stopSentence,
        priceNow,
        triggered: true,
        invalidated: false,
        effectiveEntry: fill,
        pointsFromEntry: points,
        invalidationMode,
      };
    case "pending_entry":
    default:
      return {
        status: "pending_entry",
        reason: recommendation.activationRule
          ? "لم يتحقق شرط التفعيل بعد — التوصية بانتظار شرط الدخول."
          : "لم يلمس السعر منطقة الدخول بعد.",
        priceNow,
        triggered: false,
        invalidated: false,
        invalidationMode,
      };
  }
}
