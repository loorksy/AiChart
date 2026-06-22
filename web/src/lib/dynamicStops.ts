/**
 * Adaptive stop-loss / take-profit generation — NO fixed templates.
 * Stops scale with volatility (ATR, with a 24h-range fallback), and the
 * risk:reward ratio adapts to trading style, timeframe and confidence.
 * Pure + unit-tested; the engine clamps the result to broker constraints
 * (mt5Stops) and Risk Guard still gates execution.
 */
import type { TradingSettings } from "./types";

export interface DynamicStops {
  stopLoss: number;
  takeProfit: number;
  /** Realized risk:reward used (for explainability). */
  rr: number;
  /** Stop distance as a fraction of entry (for sizing/volatility). */
  riskFraction: number;
}

/** ATR multiplier for the stop, tighter for faster styles. */
function atrMultiplier(style: TradingSettings["style"]): number {
  if (style === "aggressive") return 1.2; // scalp — tight
  if (style === "balanced") return 1.8;
  return 2.4; // conservative — wider
}

/** Base reward:risk by style; nudged up with confidence. */
function baseRR(style: TradingSettings["style"]): number {
  if (style === "aggressive") return 1.3;
  if (style === "balanced") return 1.6;
  return 2.0;
}

/**
 * Derive adaptive SL/TP from entry + volatility.
 * @param atr      ATR (price units) or null → falls back to rangePct.
 * @param rangePct fallback volatility as a fraction of price (e.g. (hi-lo)/price).
 */
export function deriveDynamicStops(params: {
  entry: number;
  side: "buy" | "sell";
  style: TradingSettings["style"];
  confidence: number; // 0-100
  atr: number | null;
  rangePct?: number;
}): DynamicStops | null {
  const { entry, side, style, confidence } = params;
  if (!Number.isFinite(entry) || entry <= 0) return null;

  // Stop distance: ATR-based, else a fraction of price, with a sane floor.
  let stopDist =
    params.atr && params.atr > 0
      ? params.atr * atrMultiplier(style)
      : entry * Math.max(params.rangePct ?? 0, 0.001) * 0.5;
  const minDist = entry * 0.0008; // floor so stops aren't absurdly tight
  if (!Number.isFinite(stopDist) || stopDist < minDist) stopDist = minDist;

  // Reward:risk adapts with confidence (±0.5 across the 0-100 range).
  const conf = Math.max(0, Math.min(100, confidence));
  const rr = Math.max(1, baseRR(style) + (conf - 50) / 100);
  const rewardDist = stopDist * rr;

  const stopLoss = side === "buy" ? entry - stopDist : entry + stopDist;
  const takeProfit = side === "buy" ? entry + rewardDist : entry - rewardDist;

  return {
    stopLoss: Number(stopLoss.toFixed(8)),
    takeProfit: Number(takeProfit.toFixed(8)),
    rr: Number(rr.toFixed(2)),
    riskFraction: stopDist / entry,
  };
}
