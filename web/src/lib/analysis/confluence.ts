import type { ForexIndicatorsResult } from "@/lib/ohlc/indicators";
import type { BreakLevel } from "./levels";
import type { PatternResult } from "./patterns";

export interface ConfluenceInput {
  indicators: ForexIndicatorsResult;
  breaks: BreakLevel[];
  pattern: PatternResult | null;
  /** Higher-timeframe trend, if available, for alignment. */
  higherTrend?: "uptrend" | "downtrend" | "sideways" | null;
}

export interface ConfluenceResult {
  /** Net directional score; positive = bullish, negative = bearish. */
  score: number;
  bias: "bullish" | "bearish" | "neutral";
  confidence: number; // 0..100
  reasons: string[];
}

/**
 * Additive confluence score (concept borrowed from atilaahmettaner/tradingview-mcp):
 * indicators + structure breaks + pattern + timeframe alignment collapse into a
 * single signed score, then a 0..100 confidence.
 */
export function analyzeConfluence(input: ConfluenceInput): ConfluenceResult {
  const { indicators, breaks, pattern, higherTrend } = input;
  let score = 0;
  const reasons: string[] = [];

  if (indicators.trend === "uptrend") {
    score += 1;
    reasons.push("الاتجاه العام صاعد");
  } else if (indicators.trend === "downtrend") {
    score -= 1;
    reasons.push("الاتجاه العام هابط");
  }

  if (indicators.rsi14 != null) {
    if (indicators.rsi14 <= 30) {
      score += 1;
      reasons.push(`RSI ${indicators.rsi14.toFixed(0)} تشبّع بيعي`);
    } else if (indicators.rsi14 >= 70) {
      score -= 1;
      reasons.push(`RSI ${indicators.rsi14.toFixed(0)} تشبّع شرائي`);
    }
  }

  if (indicators.macd) {
    if (indicators.macd.histogram > 0) {
      score += 1;
      reasons.push("MACD إيجابي");
    } else if (indicators.macd.histogram < 0) {
      score -= 1;
      reasons.push("MACD سلبي");
    }
  }

  if (pattern) {
    const weight = (pattern.confidence / 100) * 2;
    score += pattern.bias === "bullish" ? weight : -weight;
    reasons.push(`نمط ${pattern.bias === "bullish" ? "صاعد" : "هابط"} (${pattern.confidence}%)`);
  }

  for (const b of breaks) {
    score += b.direction === "bullish" ? 1.5 : -1.5;
    reasons.push(`${b.kind} ${b.direction === "bullish" ? "صعودي" : "هبوطي"}`);
  }

  if (higherTrend && higherTrend !== "sideways") {
    const agrees =
      (higherTrend === "uptrend" && score > 0) ||
      (higherTrend === "downtrend" && score < 0);
    if (agrees) {
      score += score > 0 ? 1 : -1;
      reasons.push("توافق مع الإطار الأكبر");
    } else {
      reasons.push("تعارض مع الإطار الأكبر");
    }
  }

  const bias: ConfluenceResult["bias"] =
    score > 0.5 ? "bullish" : score < -0.5 ? "bearish" : "neutral";
  // Map |score| (~0..7) onto a 50..95 confidence band.
  const confidence =
    bias === "neutral"
      ? Math.round(40 + Math.min(Math.abs(score), 0.5) * 20)
      : Math.round(Math.min(95, 50 + Math.min(Math.abs(score), 6) * 7.5));

  return { score, bias, confidence, reasons };
}
