/**
 * Gold Agent X — survival / capital preservation mode.
 */
import type { GoldAgentXConfig } from "../goldTypes";

export interface SurvivalState {
  active: boolean;
  lotMultiplier: number;
  confidenceBoost: number;
  blockNewEntries: boolean;
  reason: string;
}

export function evaluateSurvivalMode(
  config: GoldAgentXConfig,
  consecutiveLosses: number,
  drawdownPct: number,
  previouslyActive: boolean,
  consecutiveWins: number,
): SurvivalState {
  const trigger =
    consecutiveLosses >= 5 || drawdownPct >= config.survivalDrawdownPct;

  const deactivate =
    previouslyActive &&
    (consecutiveWins >= 2 || drawdownPct < 10);

  const active = previouslyActive ? !deactivate && trigger : trigger;

  if (!active) {
    return {
      active: false,
      lotMultiplier: 1,
      confidenceBoost: 0,
      blockNewEntries: false,
      reason: "وضع طبيعي",
    };
  }

  return {
    active: true,
    lotMultiplier: 0.5,
    confidenceBoost: 15,
    blockNewEntries: drawdownPct >= config.survivalDrawdownPct + 5,
    reason:
      consecutiveLosses >= 5
        ? "5 خسائر — وضع البقاء"
        : `DD ${drawdownPct.toFixed(1)}% — وضع البقاء`,
  };
}
