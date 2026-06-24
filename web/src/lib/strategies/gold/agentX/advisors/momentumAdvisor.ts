/**
 * Momentum Advisor — RSI, MACD, velocity.
 */
import type { AdvisorVote, MarketContext, RegimeInfo } from "../types";
import { clampScore } from "../types";

export function runMomentumAdvisor(ctx: MarketContext, _regime: RegimeInfo): AdvisorVote {
  const m5 = ctx.indicators.M5;
  const rsi = m5.rsi14 ?? 50;
  const macd = m5.macd;

  let vote: AdvisorVote["vote"] = "hold";
  let confidence = 45;
  let reason = "زخم محايد";

  if (rsi > 58 && macd && macd.histogram > 0) {
    vote = "buy";
    confidence = clampScore(50 + (rsi - 50));
    reason = "RSI صاعد + MACD إيجابي";
  } else if (rsi < 42 && macd && macd.histogram < 0) {
    vote = "sell";
    confidence = clampScore(50 + (50 - rsi));
    reason = "RSI هابط + MACD سلبي";
  } else if (ctx.tickVelocity > (m5.atr14 ?? 1) * 0.3) {
    const last = ctx.candles.M5.at(-1);
    const prev = ctx.candles.M5.at(-2);
    if (last && prev && last.close > prev.close) {
      vote = "buy";
      confidence = 55;
      reason = "سرعة تذبذب صعودية";
    } else if (last && prev && last.close < prev.close) {
      vote = "sell";
      confidence = 55;
      reason = "سرعة تذبذب هبوطية";
    }
  }

  return { advisor: "momentum", vote, confidence, reason };
}
