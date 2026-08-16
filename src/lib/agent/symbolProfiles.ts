/**
 * Gold's analysis profile.
 *
 * This was a per-symbol map when the platform covered 20 instruments; with a
 * single instrument it collapses to one profile, kept as a module (rather
 * than inlined constants) because the *parameters* still need one named home
 * and the bias engine still needs them injected rather than hardcoded.
 *
 * The thresholds below are gold's, and gold's alone: its typical percentage
 * range over a 50-bar window runs well above a forex major's, which is why a
 * flat 0.3% direction threshold — the value this engine used platform-wide
 * before instrument-aware parameters existed — flipped direction on ordinary
 * gold noise.
 */
import { DATA_SYMBOL } from "@/lib/gold";
import { getStrategyDeployment, type StrategyDeployment } from "@/lib/strategies/evidence";

export interface BiasEngineParams {
  /** How many recent bars biasFromCandles looks back over. */
  lookbackBars: number;
  /** Minimum |close-over-lookback| % change to call a direction (not "neutral"). */
  changeThreshold: number;
}

/**
 * A documented starting point, not a measured constant: 0.6% over 50 bars.
 * Revisit from realised outcomes once the performance journal has enough
 * gold history to derive it from evidence rather than reasoning.
 */
export const GOLD_BIAS_PARAMS: BiasEngineParams = {
  lookbackBars: 50,
  changeThreshold: 0.006,
};

/** Bias-engine parameters. One instrument, one profile. */
export function biasParamsForSymbol(_symbol?: string): BiasEngineParams {
  return GOLD_BIAS_PARAMS;
}

/**
 * The calibrated-confidence source: `strategy_deployments`, already keyed by
 * (user, strategy, symbol, timeframe) in strategies/evidence.ts. No separate
 * confidence store exists or should be introduced — the performance journal
 * is a descriptive operator log, not a calibration input.
 */
export async function calibratedConfidenceForGold(
  userId: number,
  strategyId: string,
  timeframe: string,
): Promise<StrategyDeployment | null> {
  return getStrategyDeployment(userId, strategyId, DATA_SYMBOL, timeframe);
}
