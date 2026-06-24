/**
 * Trend Advisor — HH/HL/LH/LL structure bias.
 */
import type { AdvisorVote, MarketContext, RegimeInfo } from "../types";
import { clampScore } from "../types";

export function runTrendAdvisor(ctx: MarketContext, regime: RegimeInfo): AdvisorVote {
  const s5 = ctx.structure.M5;
  const s15 = ctx.structure.M15;

  let vote: AdvisorVote["vote"] = "hold";
  let confidence = 45;
  let reason = "بنية غير حاسمة";

  if (s15.structure === "uptrend" || regime.dominant === "TRENDING_UP") {
    vote = "buy";
    confidence = clampScore(55 + regime.strength * 0.3);
    reason = "اتجاه صاعد — قمم وقيعان أعلى";
  } else if (s15.structure === "downtrend" || regime.dominant === "TRENDING_DOWN") {
    vote = "sell";
    confidence = clampScore(55 + regime.strength * 0.3);
    reason = "اتجاه هابط — قمم وقيعان أدنى";
  } else if (s5.structure === "range" || regime.dominant === "RANGE") {
    vote = "hold";
    confidence = 55;
    reason = "نطاق عرضي — لا اتجاه واضح";
  }

  if (s5.nearestSupport && ctx.quote.mid - s5.nearestSupport < (ctx.indicators.M5.atr14 ?? 2)) {
    if (vote === "hold") {
      vote = "buy";
      confidence = clampScore(confidence + 10);
      reason = "ارتداد محتمل من دعم";
    }
  }

  return { advisor: "trend", vote, confidence, reason };
}
