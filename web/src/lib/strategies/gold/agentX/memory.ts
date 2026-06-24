/**
 * Memory engine — pattern/regime/advisor stats (in bot state via engine).
 */
import type { MemoryStats, TradeJournalEntry } from "./types";

export function emptyMemory(): MemoryStats {
  return {
    patternWins: {},
    patternLosses: {},
    regimeWins: {},
    regimeLosses: {},
    advisorAccuracy: {},
  };
}

export function updateMemoryFromTrade(
  memory: MemoryStats,
  entry: TradeJournalEntry,
): MemoryStats {
  const won = entry.pnl > 0;
  const next = { ...memory, advisorAccuracy: { ...memory.advisorAccuracy } };

  if (won) next.regimeWins[entry.regime] = (next.regimeWins[entry.regime] ?? 0) + 1;
  else next.regimeLosses[entry.regime] = (next.regimeLosses[entry.regime] ?? 0) + 1;

  if (entry.fingerprint) {
    if (won)
      next.patternWins[entry.fingerprint] =
        (next.patternWins[entry.fingerprint] ?? 0) + 1;
    else
      next.patternLosses[entry.fingerprint] =
        (next.patternLosses[entry.fingerprint] ?? 0) + 1;
  }

  return next;
}
