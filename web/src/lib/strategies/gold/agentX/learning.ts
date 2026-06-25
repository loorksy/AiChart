/**
 * Learning engine — advisor accuracy from closed trades.
 */
import { updateWeightsFromMemory } from "./adaptiveWeights";
import type { MemoryStats, TradeJournalEntry } from "./types";

export function learnFromTrade(
  weights: Record<string, number>,
  memory: MemoryStats,
  entry: TradeJournalEntry,
): { weights: Record<string, number>; memory: MemoryStats } {
  const nextMemory: MemoryStats = {
    patternWins: { ...memory.patternWins },
    patternLosses: { ...memory.patternLosses },
    regimeWins: { ...memory.regimeWins },
    regimeLosses: { ...memory.regimeLosses },
    advisorAccuracy: { ...memory.advisorAccuracy },
  };

  const won = entry.pnl > 0;
  const regimeKey = entry.regime;
  if (won) nextMemory.regimeWins[regimeKey] = (nextMemory.regimeWins[regimeKey] ?? 0) + 1;
  else nextMemory.regimeLosses[regimeKey] = (nextMemory.regimeLosses[regimeKey] ?? 0) + 1;

  if (entry.fingerprint) {
    const pk = entry.fingerprint;
    if (won) nextMemory.patternWins[pk] = (nextMemory.patternWins[pk] ?? 0) + 1;
    else nextMemory.patternLosses[pk] = (nextMemory.patternLosses[pk] ?? 0) + 1;
  }

  for (const v of entry.advisorVotes) {
    if (v.vote === "hold") continue;
    const stats = nextMemory.advisorAccuracy[v.advisor] ?? { correct: 0, total: 0 };
    const voteBuy = v.vote === "buy";
    const tradeBuy = entry.side === "buy";
    const aligned = voteBuy === tradeBuy;
    const correct = won ? aligned : !aligned;
    nextMemory.advisorAccuracy[v.advisor] = {
      correct: stats.correct + (correct ? 1 : 0),
      total: stats.total + 1,
    };
  }

  const nextWeights = updateWeightsFromMemory(weights, nextMemory);
  return { weights: nextWeights, memory: nextMemory };
}
