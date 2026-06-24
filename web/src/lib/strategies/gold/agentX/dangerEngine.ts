/**
 * Gold Agent X — danger classification engine.
 */
import type { DangerAssessment, MarketContext, RegimeInfo } from "./types";
import type { DangerLevel } from "./types";
import { clampScore } from "./types";

export function assessDanger(ctx: MarketContext, regime: RegimeInfo): DangerAssessment {
  const spreadRatio =
    ctx.quote.mid > 0 ? ctx.quote.spread / ctx.quote.mid : 0;
  const atr = ctx.indicators.M5.atr14 ?? 1;
  const velocity = ctx.tickVelocity;
  const newsProb = regime.probabilities.NEWS_REACTION;

  let dangerPoints = 0;
  if (spreadRatio > 0.0003) dangerPoints += 25;
  if (spreadRatio > 0.0005) dangerPoints += 25;
  if (velocity > atr * 1.5) dangerPoints += 20;
  if (velocity > atr * 2.5) dangerPoints += 20;
  if (newsProb > 30) dangerPoints += 20;
  if (regime.probabilities.VOLATILE > 45) dangerPoints += 15;

  dangerPoints = clampScore(dangerPoints);

  let level: DangerLevel = "NORMAL";
  if (dangerPoints >= 75) level = "EXTREME_DANGER";
  else if (dangerPoints >= 55) level = "DANGER";
  else if (dangerPoints >= 35) level = "CAUTION";

  switch (level) {
    case "EXTREME_DANGER":
      return {
        level,
        lotMultiplier: 0,
        confidenceBoost: 20,
        allowEntry: false,
        reason: "خطر شديد — لا تداول",
      };
    case "DANGER":
      return {
        level,
        lotMultiplier: 0.5,
        confidenceBoost: 10,
        allowEntry: true,
        minTradeScoreOverride: 80,
        reason: "خطر مرتفع — شروط دخول صارمة",
      };
    case "CAUTION":
      return {
        level,
        lotMultiplier: 0.75,
        confidenceBoost: 5,
        allowEntry: true,
        reason: "حذر — تقليل الحجم",
      };
    default:
      return {
        level,
        lotMultiplier: 1,
        confidenceBoost: 0,
        allowEntry: true,
        reason: "ظروف طبيعية",
      };
  }
}
