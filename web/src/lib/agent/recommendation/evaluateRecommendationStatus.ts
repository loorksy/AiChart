import {
  isTerminalRecommendationStatus,
  type ActiveRecommendation,
  type RecommendationStatus,
} from "../sessionRecommendation";
import type { AgentMarketContext } from "../marketContext/buildAgentMarketContext";

export interface RecommendationStatusEvaluation {
  status: RecommendationStatus;
  reason: string;
  priceNow: number;
  triggered: boolean;
  invalidated: boolean;
  hitTarget?: number;
}

function candlesAfterCreation(
  recommendation: ActiveRecommendation,
  market: AgentMarketContext,
) {
  // Prefer the creation candle's time and evaluate STRICTLY after it, so the
  // candle that created the recommendation can never trigger/SL it. Fall back
  // to createdAt (inclusive) only when the creation candle time is unknown.
  if (recommendation.createdCandleTime != null) {
    return market.currentTfCandles.filter(
      (c) => c.time > recommendation.createdCandleTime!,
    );
  }
  return market.currentTfCandles.filter((c) => c.time >= recommendation.createdAt);
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

  if (recommendation.expiresAt && Date.now() > recommendation.expiresAt) {
    return {
      status: "expired",
      reason: "انتهت صلاحية التوصية زمنياً.",
      priceNow,
      triggered: false,
      invalidated: false,
    };
  }

  const candles = candlesAfterCreation(recommendation, market);
  const direction = recommendation.direction;
  let triggered = recommendation.status !== "pending_entry";

  for (const candle of candles) {
    const touchedEntry =
      direction === "buy"
        ? candle.low <= recommendation.entry
        : candle.high >= recommendation.entry;
    if (!triggered && touchedEntry) triggered = true;

    const invalidated =
      direction === "buy"
        ? candle.close <= recommendation.invalidationLevel
        : candle.close >= recommendation.invalidationLevel;
    if (invalidated) {
      return {
        status: "invalidated",
        reason: recommendation.invalidationRule,
        priceNow,
        triggered,
        invalidated: true,
      };
    }

    if (triggered) {
      const slHit =
        direction === "buy"
          ? candle.low <= recommendation.stopLoss
          : candle.high >= recommendation.stopLoss;
      if (slHit) {
        return {
          status: "sl_hit",
          reason: "تم ضرب وقف الخسارة بعد تفعيل الدخول.",
          priceNow,
          triggered: true,
          invalidated: false,
        };
      }

      for (let i = 0; i < recommendation.targets.length; i++) {
        const target = recommendation.targets[i]!;
        const hit =
          direction === "buy" ? candle.high >= target : candle.low <= target;
        if (hit) {
          return {
            status: i === 0 ? "tp1_hit" : "tp2_hit",
            reason: `تحقق الهدف ${i + 1}.`,
            priceNow,
            triggered: true,
            invalidated: false,
            hitTarget: i + 1,
          };
        }
      }
    }
  }

  return {
    status: triggered ? "triggered" : "pending_entry",
    reason: triggered
      ? "دخلت الصفقة وما زالت تحت المتابعة."
      : "لم يلمس السعر منطقة الدخول بعد.",
    priceNow,
    triggered,
    invalidated: false,
  };
}

