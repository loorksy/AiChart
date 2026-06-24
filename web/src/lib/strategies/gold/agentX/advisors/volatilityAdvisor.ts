/**
 * Volatility Advisor — ATR, Bollinger expansion/compression.
 */
import type { AdvisorVote, MarketContext, RegimeInfo } from "../types";
import { clampScore } from "../types";

export function runVolatilityAdvisor(ctx: MarketContext, regime: RegimeInfo): AdvisorVote {
  const m5 = ctx.indicators.M5;
  const atr = m5.atr14 ?? 0;
  const bb = m5.bollinger;
  const mid = ctx.quote.mid;

  let vote: AdvisorVote["vote"] = "hold";
  let confidence = 50;
  let reason = "تذبذب طبيعي";

  if (regime.dominant === "VOLATILE" || regime.probabilities.VOLATILE > 40) {
    vote = "hold";
    confidence = 65;
    reason = "تذبذب مرتفع — تجنب دخول عشوائي";
    return { advisor: "volatility", vote, confidence, reason };
  }

  if (bb && mid > 0) {
    const width = (bb.upper - bb.lower) / mid;
    if (width < 0.002) {
      vote = "hold";
      confidence = 58;
      reason = "ضغط بولinger — انتظار انفجار";
    } else if (width > 0.006 && regime.dominant === "BREAKOUT") {
      vote = m5.trend === "uptrend" ? "buy" : m5.trend === "downtrend" ? "sell" : "hold";
      confidence = clampScore(60 + width * 1000);
      reason = "توسع تذبذب مع اختراق";
    }
  }

  if (atr > 0 && ctx.tickVelocity < atr * 0.15 && regime.dominant === "RANGE") {
    confidence = clampScore(confidence + 5);
    reason = "تذبذب منخفض في نطاق";
  }

  return { advisor: "volatility", vote, confidence, reason };
}
