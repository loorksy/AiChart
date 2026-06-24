/**
 * Gold Agent X — advanced exit engine (no fixed TP).
 */
import type { GoldAgentXPosition, GoldSide } from "../goldTypes";
import type { ExitResult, MarketContext, RegimeInfo } from "./types";
import { evaluateTimeframeAlignment } from "./timeframeAlignment";

export interface ExitInput {
  ctx: MarketContext;
  regime: RegimeInfo;
  position: GoldAgentXPosition;
  side: GoldSide;
  barsHeld: number;
}

export function evaluateExit(input: ExitInput): ExitResult {
  const { ctx, regime, position, side, barsHeld } = input;
  const price = side === "buy" ? ctx.quote.bid : ctx.quote.ask;
  const atr = ctx.indicators.M5.atr14 ?? 2;
  const pnl = side === "buy" ? price - position.price : position.price - price;
  const align = evaluateTimeframeAlignment(ctx);

  // Trailing structure stop
  if (position.stopLoss != null) {
    if (side === "buy" && price <= position.stopLoss) {
      return { action: "close", reason: "وقف trailing" };
    }
    if (side === "sell" && price >= position.stopLoss) {
      return { action: "close", reason: "وقف trailing" };
    }
  }

  // Break-even after 1 ATR profit
  if (pnl >= atr && barsHeld >= 2) {
    const be = position.price;
    if (side === "buy" && price < be + atr * 0.1) {
      return { action: "close", reason: "حماية التعادل" };
    }
    if (side === "sell" && price > be - atr * 0.1) {
      return { action: "close", reason: "حماية التعادل" };
    }
  }

  // Momentum decay
  const rsi = ctx.indicators.M5.rsi14 ?? 50;
  if (side === "buy" && rsi < 45 && pnl > 0) {
    return { action: "close", reason: "تآكل زخم صعودي" };
  }
  if (side === "sell" && rsi > 55 && pnl > 0) {
    return { action: "close", reason: "تآكل زخم هبوطي" };
  }

  // Structure failure
  if (side === "buy" && regime.dominant === "TRENDING_DOWN" && regime.confidence > 65) {
    if (!align.aligned || align.direction === "sell") {
      return { action: "close", reason: "فشل بنية صعودية" };
    }
  }
  if (side === "sell" && regime.dominant === "TRENDING_UP" && regime.confidence > 65) {
    if (!align.aligned || align.direction === "buy") {
      return { action: "close", reason: "فشل بنية هبوطية" };
    }
  }

  // Liquidity target
  const res = ctx.structure.M5.nearestResistance;
  const sup = ctx.structure.M5.nearestSupport;
  if (side === "buy" && res && price >= res - atr * 0.15 && pnl > atr * 0.5) {
    return { action: "partial_close", partialPct: 50, reason: "هدف سيولة علوي" };
  }
  if (side === "sell" && sup && price <= sup + atr * 0.15 && pnl > atr * 0.5) {
    return { action: "partial_close", partialPct: 50, reason: "هدف سيولة سفلي" };
  }

  // Anti early exit — strong trend
  if (
    align.aligned &&
    align.direction === side &&
    regime.dominant.includes("TRENDING") &&
    pnl > -atr * 0.3
  ) {
    return { action: "hold", reason: "اتجاه قوي — استمرار" };
  }

  // Reverse signal
  if (pnl < -atr * 1.5 && barsHeld >= 3) {
    const reverseSide: GoldSide = side === "buy" ? "sell" : "buy";
    if (
      (reverseSide === "buy" && regime.dominant === "TRENDING_UP") ||
      (reverseSide === "sell" && regime.dominant === "TRENDING_DOWN")
    ) {
      return { action: "reverse", reverseSide, reason: "انعكاس نظام السوق" };
    }
  }

  if (pnl < -atr * (position.stopLoss ? 1 : 2)) {
    return { action: "close", reason: "وقف ATR" };
  }

  return { action: "hold", reason: "مراقبة" };
}

export function computeTrailingStop(
  side: GoldSide,
  entry: number,
  atr: number,
  mult: number,
): number {
  const dist = atr * mult;
  return side === "buy" ? entry - dist : entry + dist;
}
