/**
 * Gold Agent X — dynamic position sizing (no martingale).
 */
import { pipSizeForSymbol } from "@/lib/spread";
import { GOLD_SYMBOL } from "../goldDefaults";
import type { GoldAgentXConfig } from "../goldTypes";
import type { DangerAssessment, RegimeInfo, SizingResult } from "./types";

export interface SizingInput {
  config: GoldAgentXConfig;
  confidence: number;
  tradeQuality: number;
  tradeScore: number;
  regime: RegimeInfo;
  atr: number;
  drawdownPct: number;
  survivalMultiplier: number;
  danger: DangerAssessment;
  executionQualityAvg: number;
}

function roundLot(lot: number, step: number): number {
  const s = step > 0 ? step : 0.01;
  return Math.round(lot / s) * s;
}

export function computePositionSize(input: SizingInput): SizingResult {
  const { config } = input;
  let lot = config.initialLot;

  const confFactor = 0.5 + (input.confidence / 100) * 0.5;
  const qualFactor = 0.5 + (input.tradeQuality / 100) * 0.5;
  const scoreFactor = 0.5 + (input.tradeScore / 100) * 0.5;
  lot *= confFactor * qualFactor * scoreFactor;

  lot *= input.danger.lotMultiplier;
  lot *= input.survivalMultiplier;

  if (input.drawdownPct > config.drawdownTightenPct * 0.5) {
    lot *= 0.75;
  }
  if (input.drawdownPct > config.drawdownTightenPct) {
    lot *= 0.5;
  }

  if (input.executionQualityAvg < 50) lot *= 0.7;
  if (input.executionQualityAvg < 30) lot *= 0.5;

  const regimeBoost = input.regime.probabilities[input.regime.dominant] / 100;
  lot *= 0.8 + regimeBoost * 0.2;

  lot = Math.min(lot, config.maxLot);
  lot = Math.max(lot, config.lotStep ?? 0.01);
  lot = roundLot(lot, config.lotStep ?? 0.01);

  return {
    lot,
    reason: `conf=${input.confidence} Q=${input.tradeQuality} S=${input.tradeScore} dd=${input.drawdownPct.toFixed(1)}%`,
  };
}

export function pipsToPrice(pips: number, midPrice?: number): number {
  return pips * pipSizeForSymbol(GOLD_SYMBOL, midPrice);
}
