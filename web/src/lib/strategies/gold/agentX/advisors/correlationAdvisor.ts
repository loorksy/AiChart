/**
 * Correlation Advisor — DXY/US10Y/VIX (neutral if unavailable).
 */
import { fetchOhlc } from "@/lib/ohlc/fetchOhlc";
import { computeForexIndicators } from "@/lib/ohlc/indicators";
import type { GoldAgentXConfig } from "../../goldTypes";
import type { AdvisorVote, CorrelationData, CorrelationSnapshot, MarketContext, RegimeInfo } from "../types";
import { clampScore } from "../types";

export type CorrelationSymbolAliases = GoldAgentXConfig["correlationSymbols"];

async function fetchOne(
  userId: number,
  symbol: string,
): Promise<CorrelationSnapshot | null> {
  try {
    const res = await fetchOhlc({
      userId,
      symbol,
      market: "forex",
      interval: "M15",
      limit: 50,
    });
    if (res.candles.length < 10) return null;
    const ind = computeForexIndicators(symbol, "M15", res.candles, res.source);
    const first = res.candles[0]!.close;
    const last = res.candles[res.candles.length - 1]!.close;
    const changePct = first > 0 ? ((last - first) / first) * 100 : 0;
    return {
      symbol,
      trend: ind.trend,
      rsi14: ind.rsi14,
      changePct,
      available: true,
    };
  } catch {
    return null;
  }
}

async function fetchFirstAvailable(
  userId: number,
  symbols: string[] | undefined,
): Promise<CorrelationSnapshot | null> {
  if (!symbols?.length) return null;
  for (const sym of symbols) {
    const snap = await fetchOne(userId, sym);
    if (snap) return snap;
  }
  return null;
}

export async function fetchCorrelationData(
  userId: number,
  aliases: CorrelationSymbolAliases,
): Promise<CorrelationData> {
  const [dxy, us10y, vix] = await Promise.all([
    fetchFirstAvailable(userId, aliases.dxy),
    fetchFirstAvailable(userId, aliases.us10y),
    fetchFirstAvailable(userId, aliases.vix),
  ]);
  return { dxy, us10y, vix };
}

export function runCorrelationAdvisor(ctx: MarketContext, _regime: RegimeInfo): AdvisorVote {
  const { dxy, us10y } = ctx.correlation;

  if (!dxy?.available && !us10y?.available) {
    return {
      advisor: "correlation",
      vote: "hold",
      confidence: 50,
      reason: "بيانات ارتباط غير متاحة — محايد",
    };
  }

  let goldBias: AdvisorVote["vote"] = "hold";
  let score = 50;
  const reasons: string[] = [];

  if (dxy?.available) {
    if (dxy.trend === "uptrend" || dxy.changePct > 0.05) {
      goldBias = "sell";
      score += 12;
      reasons.push("DXY صاعد");
    } else if (dxy.trend === "downtrend" || dxy.changePct < -0.05) {
      goldBias = "buy";
      score += 12;
      reasons.push("DXY هابط");
    }
  }

  if (us10y?.available) {
    if (us10y.changePct > 0.03) {
      if (goldBias === "buy") goldBias = "hold";
      else goldBias = "sell";
      score += 8;
      reasons.push("US10Y يرتفع");
    } else if (us10y.changePct < -0.03) {
      if (goldBias === "sell") goldBias = "hold";
      else goldBias = "buy";
      score += 8;
      reasons.push("US10Y ينخفض");
    }
  }

  return {
    advisor: "correlation",
    vote: goldBias,
    confidence: clampScore(score),
    reason: reasons.length ? reasons.join(" · ") : "ارتباط محايد",
  };
}
