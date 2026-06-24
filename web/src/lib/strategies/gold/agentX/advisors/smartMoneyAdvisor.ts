/**
 * Smart Money Advisor — BOS, CHOCH, OB, FVG, sweeps (deterministic heuristics).
 */
import type { AdvisorVote, MarketContext, RegimeInfo } from "../types";
import { clampScore } from "../types";

function detectBos(ctx: MarketContext): "buy" | "sell" | null {
  const highs = ctx.structure.M5.swingHighs;
  const lows = ctx.structure.M5.swingLows;
  const price = ctx.quote.mid;
  if (highs.length >= 2 && price > highs[highs.length - 1]!) return "buy";
  if (lows.length >= 2 && price < lows[lows.length - 1]!) return "sell";
  return null;
}

function detectSweep(ctx: MarketContext): "buy" | "sell" | null {
  const s = ctx.structure.M5;
  const atr = ctx.indicators.M5.atr14 ?? 2;
  if (s.nearestSupport && ctx.quote.mid < s.nearestSupport - atr * 0.1) {
    if (ctx.candles.M5.at(-1)?.close ?? 0 > s.nearestSupport) return "buy";
  }
  if (s.nearestResistance && ctx.quote.mid > s.nearestResistance + atr * 0.1) {
    if ((ctx.candles.M5.at(-1)?.close ?? 0) < s.nearestResistance) return "sell";
  }
  return null;
}

export function runSmartMoneyAdvisor(ctx: MarketContext, regime: RegimeInfo): AdvisorVote {
  const bos = detectBos(ctx);
  const sweep = detectSweep(ctx);

  if (sweep === "buy") {
    return {
      advisor: "smartMoney",
      vote: "buy",
      confidence: 72,
      reason: "سحب سيولة ثم ارتداد — BOS صعودي",
    };
  }
  if (sweep === "sell") {
    return {
      advisor: "smartMoney",
      vote: "sell",
      confidence: 72,
      reason: "سحب سيولة ثم انعكاس — BOS هبوطي",
    };
  }

  if (bos === "buy" && regime.dominant !== "RANGE") {
    return {
      advisor: "smartMoney",
      vote: "buy",
      confidence: clampScore(60 + regime.strength * 0.2),
      reason: "كسر بنية صعودي (BOS)",
    };
  }
  if (bos === "sell" && regime.dominant !== "RANGE") {
    return {
      advisor: "smartMoney",
      vote: "sell",
      confidence: clampScore(60 + regime.strength * 0.2),
      reason: "كسر بنية هبوطي (BOS)",
    };
  }

  if (regime.dominant === "ACCUMULATION") {
    return { advisor: "smartMoney", vote: "buy", confidence: 58, reason: "تراكم — OB محتمل" };
  }
  if (regime.dominant === "DISTRIBUTION") {
    return { advisor: "smartMoney", vote: "sell", confidence: 58, reason: "توزيع — FVG هابط" };
  }

  return {
    advisor: "smartMoney",
    vote: "hold",
    confidence: 45,
    reason: "لا إشارة SMC واضحة",
  };
}
