/**
 * Gold Agent X — deterministic optimizer (every N trades).
 */
import { defaultAdaptiveWeights, normalizeWeights } from "./adaptiveWeights";
import type { GoldAgentXConfig } from "../goldTypes";
import type { PerformanceSnapshot, TradeJournalEntry } from "./types";

export interface OptimizerResult {
  weights: Record<string, number>;
  minConfidenceDelta: number;
  ran: boolean;
  reason: string;
}

export function runOptimizer(
  config: GoldAgentXConfig,
  tradesSinceOptimizer: number,
  journal: TradeJournalEntry[],
  currentWeights: Record<string, number>,
  performance: PerformanceSnapshot,
): OptimizerResult {
  const interval =
    config.optimizerIntervalTrades ??
    config.optimizerTradeInterval ??
    75;
  if (tradesSinceOptimizer < interval || journal.length < 10) {
    return {
      weights: currentWeights,
      minConfidenceDelta: 0,
      ran: false,
      reason: "انتظار عينة كافية",
    };
  }

  let weights = { ...defaultAdaptiveWeights(), ...currentWeights };

  const advisorWins: Record<string, number> = {};
  const advisorTotals: Record<string, number> = {};

  for (const t of journal.slice(0, interval)) {
    const won = t.pnl > 0;
    for (const v of t.advisorVotes) {
      if (v.vote === "hold") continue;
      advisorTotals[v.advisor] = (advisorTotals[v.advisor] ?? 0) + 1;
      if ((won && v.vote === t.side) || (!won && v.vote !== t.side)) {
        advisorWins[v.advisor] = (advisorWins[v.advisor] ?? 0) + 1;
      }
    }
  }

  for (const [advisor, total] of Object.entries(advisorTotals)) {
    if (total < 5) continue;
    const acc = (advisorWins[advisor] ?? 0) / total;
    if (acc > 0.55) weights[advisor] = Math.min(2, (weights[advisor] ?? 1) * 1.08);
    else if (acc < 0.45) weights[advisor] = Math.max(0.3, (weights[advisor] ?? 1) * 0.92);
  }

  weights = normalizeWeights(weights);

  let minConfidenceDelta = 0;
  if (performance.winRate < 45 && performance.totalTrades >= 20) {
    minConfidenceDelta = 3;
  } else if (performance.winRate > 60) {
    minConfidenceDelta = -2;
  }

  return {
    weights,
    minConfidenceDelta,
    ran: true,
    reason: `optimizer@${interval} trades WR=${performance.winRate.toFixed(1)}%`,
  };
}
