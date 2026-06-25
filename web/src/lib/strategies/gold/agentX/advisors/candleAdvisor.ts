/**
 * Candle Advisor — engulfing, hammer, pin bar patterns.
 */
import { resolveGoldEntrySignal } from "../../candlePatterns";
import type { AdvisorVote, MarketContext } from "../types";
import { clampScore } from "../types";
import type { RegimeInfo } from "../types";

export function runCandleAdvisor(ctx: MarketContext, _regime: RegimeInfo): AdvisorVote {
  const candles = ctx.candles.M5;
  const signal = resolveGoldEntrySignal(candles);

  if (!signal) {
    return {
      advisor: "candle",
      vote: "hold",
      confidence: 40,
      reason: "لا نمط شموع واضح",
    };
  }

  const strongPatterns = new Set([
    "bullish_engulfing",
    "bearish_engulfing",
    "hammer",
    "shooting_star",
  ]);
  const boost = strongPatterns.has(signal.pattern) ? 15 : 5;

  return {
    advisor: "candle",
    vote: signal.side,
    confidence: clampScore(55 + boost),
    reason: `نمط ${signal.pattern}`,
  };
}
