/**
 * Gold Agent X — performance metrics engine.
 */
import type { PerformanceSnapshot, TradeJournalEntry } from "./types";

export function emptyPerformance(): PerformanceSnapshot {
  return {
    winRate: 0,
    profitFactor: 0,
    expectancy: 0,
    totalTrades: 0,
    wins: 0,
    losses: 0,
    avgWin: 0,
    avgLoss: 0,
  };
}

export function updatePerformance(
  prev: PerformanceSnapshot,
  entry: TradeJournalEntry,
): PerformanceSnapshot {
  const won = entry.pnl > 0;
  const wins = prev.wins + (won ? 1 : 0);
  const losses = prev.losses + (won ? 0 : 1);
  const totalTrades = prev.totalTrades + 1;

  const grossWin =
    (prev.avgWin * prev.wins + (won ? entry.pnl : 0)) / Math.max(wins, 1);
  const grossLoss =
    (prev.avgLoss * prev.losses + (!won ? Math.abs(entry.pnl) : 0)) /
    Math.max(losses, 1);

  const totalWinPnl = grossWin * wins;
  const totalLossPnl = grossLoss * losses;
  const profitFactor =
    totalLossPnl > 0 ? totalWinPnl / totalLossPnl : totalWinPnl > 0 ? 99 : 0;

  const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;
  const expectancy =
    totalTrades > 0
      ? (totalWinPnl - totalLossPnl) / totalTrades
      : 0;

  const sessionCounts: Record<string, { w: number; t: number }> = {};
  sessionCounts[entry.session] = { w: won ? 1 : 0, t: 1 };

  let bestAdvisor = prev.bestAdvisor;
  let bestAdvisorScore = 0;
  for (const v of entry.advisorVotes) {
    if (v.vote === entry.side && v.confidence > bestAdvisorScore) {
      bestAdvisorScore = v.confidence;
      bestAdvisor = v.advisor;
    }
  }

  return {
    winRate,
    profitFactor,
    expectancy,
    totalTrades,
    wins,
    losses,
    avgWin: grossWin,
    avgLoss: grossLoss,
    bestSession: entry.session,
    bestRegime: entry.regime,
    bestAdvisor,
  };
}
