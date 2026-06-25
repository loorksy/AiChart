/**
 * Fear Advisor — spread/ATR shock (reduce-only bias).
 */
import type { AdvisorVote, MarketContext, RegimeInfo } from "../types";
import { clampScore } from "../types";

export function runFearAdvisor(ctx: MarketContext, regime: RegimeInfo): AdvisorVote {
  const spreadRatio =
    ctx.quote.mid > 0 ? ctx.quote.spread / ctx.quote.mid : 0;
  const atr = ctx.indicators.M5.atr14 ?? 1;
  const velocity = ctx.tickVelocity;

  let fearScore = 0;
  if (spreadRatio > 0.00025) fearScore += 30;
  if (velocity > atr * 1.5) fearScore += 35;
  if (regime.probabilities.NEWS_REACTION > 25) fearScore += 25;
  if (regime.probabilities.VOLATILE > 35) fearScore += 20;

  fearScore = clampScore(fearScore);

  if (fearScore >= 60) {
    return {
      advisor: "fear",
      vote: "hold",
      confidence: fearScore,
      reason: "صدمة spread/ATR — خفض المخاطرة",
    };
  }

  return {
    advisor: "fear",
    vote: "hold",
    confidence: clampScore(40 + fearScore * 0.3),
    reason: "ظروف مخاطرة مقبولة",
  };
}
