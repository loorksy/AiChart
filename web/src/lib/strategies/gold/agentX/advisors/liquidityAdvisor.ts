/**
 * Liquidity Advisor — equal highs/lows, stop hunts, fake breakouts.
 */
import type { AdvisorVote, MarketContext, RegimeInfo } from "../types";
import { clampScore } from "../types";

function equalLevels(prices: number[], tolerancePct = 0.0005): boolean {
  if (prices.length < 2) return false;
  const a = prices[prices.length - 1]!;
  const b = prices[prices.length - 2]!;
  return Math.abs(a - b) / a <= tolerancePct;
}

export function runLiquidityAdvisor(ctx: MarketContext, _regime: RegimeInfo): AdvisorVote {
  const highs = ctx.structure.M5.swingHighs;
  const lows = ctx.structure.M5.swingLows;
  const atr = ctx.indicators.M5.atr14 ?? 2;
  const price = ctx.quote.mid;

  const equalHighs = equalLevels(highs);
  const equalLows = equalLevels(lows);

  // Active stop hunt — block entry
  if (equalHighs && price > (highs[highs.length - 1] ?? price) - atr * 0.05) {
    const last = ctx.candles.M5.at(-1);
    if (last && last.close < last.open) {
      return {
        advisor: "liquidity",
        vote: "hold",
        confidence: 70,
        reason: "اصطياد سيولة عند equal highs — لا دخول",
      };
    }
  }
  if (equalLows && price < (lows[lows.length - 1] ?? price) + atr * 0.05) {
    const last = ctx.candles.M5.at(-1);
    if (last && last.close > last.open) {
      return {
        advisor: "liquidity",
        vote: "hold",
        confidence: 70,
        reason: "اصطياد سيولة عند equal lows — لا دخول",
      };
    }
  }

  // Post-sweep entry
  if (equalLows && price > (lows[lows.length - 1] ?? 0) + atr * 0.2) {
    return {
      advisor: "liquidity",
      vote: "buy",
      confidence: clampScore(65),
      reason: "انتهاء سحب سيولة سفلي",
    };
  }
  if (equalHighs && price < (highs[highs.length - 1] ?? price) - atr * 0.2) {
    return {
      advisor: "liquidity",
      vote: "sell",
      confidence: clampScore(65),
      reason: "انتهاء سحب سيولة علوي",
    };
  }

  return {
    advisor: "liquidity",
    vote: "hold",
    confidence: 50,
    reason: "لا حدث سيولة حاسم",
  };
}
