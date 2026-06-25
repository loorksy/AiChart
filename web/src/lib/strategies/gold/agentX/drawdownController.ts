/**
 * Gold Agent X — drawdown intelligence.
 */
import type { GoldAgentXConfig } from "../goldTypes";

export interface DrawdownState {
  effectiveMinConfidence: number;
  lotMultiplier: number;
  tradeFrequencyReduced: boolean;
  reason: string;
}

export function evaluateDrawdownControl(
  config: GoldAgentXConfig,
  consecutiveLosses: number,
  drawdownPct: number,
  baseMinConfidence: number,
): DrawdownState {
  let effectiveMinConfidence = baseMinConfidence;
  let lotMultiplier = 1;
  let tradeFrequencyReduced = false;
  const reasons: string[] = [];

  if (consecutiveLosses >= 3) {
    effectiveMinConfidence += 5;
    lotMultiplier *= 0.75;
    tradeFrequencyReduced = true;
    reasons.push("3 خسائر متتالية");
  }

  if (drawdownPct >= config.drawdownTightenPct) {
    effectiveMinConfidence += 8;
    lotMultiplier *= 0.6;
    tradeFrequencyReduced = true;
    reasons.push(`DD ${drawdownPct.toFixed(1)}%`);
  }

  return {
    effectiveMinConfidence: Math.min(85, effectiveMinConfidence),
    lotMultiplier,
    tradeFrequencyReduced,
    reason: reasons.join(" · ") || "طبيعي",
  };
}

export function shouldRecoverDrawdown(
  consecutiveWins: number,
  drawdownPct: number,
): boolean {
  return consecutiveWins >= 2 || drawdownPct < configRecoverThreshold();
}

function configRecoverThreshold(): number {
  return 8;
}
