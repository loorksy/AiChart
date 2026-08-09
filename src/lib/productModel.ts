import { z } from "zod";

/** The only operator-controlled trading preference in AiChart. */
export const RISK_PER_TRADE = {
  min: 0.1,
  max: 5,
  step: 0.1,
  default: 1,
} as const;

export const riskPerTradeSchema = z
  .number()
  .finite()
  .min(RISK_PER_TRADE.min)
  .max(RISK_PER_TRADE.max)
  .multipleOf(RISK_PER_TRADE.step);

export function normalizeRiskPerTrade(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return RISK_PER_TRADE.default;
  if (parsed < RISK_PER_TRADE.min || parsed > RISK_PER_TRADE.max) {
    return RISK_PER_TRADE.default;
  }
  const steps = Math.round(parsed / RISK_PER_TRADE.step);
  return Number((steps * RISK_PER_TRADE.step).toFixed(1));
}

/** Scalping is a product invariant, not a stored or selectable preference. */
export const TRADING_STYLE = "scalp" as const;
export const SCALP_DEFAULT_INTERVAL = "5m";

/** Evidence context for the sole supported product cadence. */
export const SCALPING_CONTEXT = {
  style: TRADING_STYLE,
  holdingHorizon: "minutes",
  stopApproach: "tight_structure",
  targetApproach: "quick_partial",
  contextEmphasis: "momentum",
  higherTimeframes: "evidence_only",
} as const;
