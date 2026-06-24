/**
 * Gold Agent X — multi-timeframe alignment score.
 */
import type { MarketContext } from "./types";
import { clampScore } from "./types";

export interface TimeframeAlignment {
  score: number;
  aligned: boolean;
  direction: "buy" | "sell" | "neutral";
  summary: string;
}

export function evaluateTimeframeAlignment(ctx: MarketContext): TimeframeAlignment {
  const trends = [
    ctx.indicators.M1.trend,
    ctx.indicators.M5.trend,
    ctx.indicators.M15.trend,
  ];
  const structures = [
    ctx.structure.M5.structure,
    ctx.structure.M15.structure,
  ];

  let up = 0;
  let down = 0;
  for (const t of trends) {
    if (t === "uptrend") up++;
    if (t === "downtrend") down++;
  }
  for (const s of structures) {
    if (s === "uptrend") up++;
    if (s === "downtrend") down++;
  }

  const total = trends.length + structures.length;
  let direction: "buy" | "sell" | "neutral" = "neutral";
  let score = 50;

  if (up >= total * 0.6) {
    direction = "buy";
    score = clampScore(50 + (up / total) * 50);
  } else if (down >= total * 0.6) {
    direction = "sell";
    score = clampScore(50 + (down / total) * 50);
  } else {
    score = clampScore(30 + Math.max(up, down) * 8);
  }

  return {
    score,
    aligned: score >= 60,
    direction,
    summary:
      direction === "buy"
        ? "محاذاة صعودية عبر الأطر"
        : direction === "sell"
          ? "محاذاة هبوطية عبر الأطر"
          : "عدم اتساق بين الأطر",
  };
}
