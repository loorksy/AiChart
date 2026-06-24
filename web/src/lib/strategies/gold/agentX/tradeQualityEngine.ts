/**
 * Gold Agent X — independent trade quality gate (0–100).
 */
import type {
  CouncilResult,
  MarketContext,
  RegimeInfo,
  TradeQualityResult,
} from "./types";
import { clampScore } from "./types";
import { evaluateTimeframeAlignment } from "./timeframeAlignment";
import { sessionWeightModifier } from "./advisors/sessionAdvisor";

export function scoreTradeQuality(
  ctx: MarketContext,
  regime: RegimeInfo,
  council: CouncilResult,
): TradeQualityResult {
  const reasons: string[] = [];
  let score = 40;

  const align = evaluateTimeframeAlignment(ctx);
  score += align.score * 0.25;
  if (align.aligned) reasons.push("محاذاة MTF");

  const regimeAlign =
    regime.probabilities[regime.dominant] / 100;
  score += regimeAlign * 20;
  reasons.push(`نظام ${regime.dominant} ${regime.probabilities[regime.dominant]}%`);

  const agreement =
    Math.max(council.buyWeight, council.sellWeight) /
    (council.buyWeight + council.sellWeight + council.holdWeight || 1);
  score += agreement * 25;
  if (agreement > 0.55) reasons.push("توافق المستشارين");

  score *= sessionWeightModifier(ctx.session.session) * 0.95 + 0.05;

  const corr = ctx.correlation;
  if (corr.dxy?.available || corr.us10y?.available) {
    score += 5;
    reasons.push("ارتباط متاح");
  }

  const vol = ctx.indicators.M5.atr14;
  if (vol && vol > 0 && ctx.tickVelocity < vol) {
    score += 5;
    reasons.push("تذبذب مقبول");
  }

  score = clampScore(score);

  let tier: TradeQualityResult["tier"] = "reject";
  if (score >= 90) tier = "premium";
  else if (score >= 75) tier = "strong";
  else if (score >= 60) tier = "normal";

  return { score, tier, reasons };
}
