/**
 * Gold Agent X — setup library pattern matching.
 */
import type { CouncilResult, MarketContext, RegimeInfo, SetupMatch } from "./types";

export interface StoredSetup {
  fingerprint: string;
  winRate: number;
  profitFactor: number;
  samples: number;
  failed?: boolean;
}

export function fingerprintSetup(
  ctx: MarketContext,
  regime: RegimeInfo,
  council: CouncilResult,
): string {
  const parts = [
    ctx.session.session,
    regime.dominant,
    council.consensusSide,
    ctx.structure.M15.structure,
  ];
  return parts.join("+");
}

export function matchSetup(
  fingerprint: string,
  library: StoredSetup[],
): SetupMatch | null {
  const match = library.find((s) => s.fingerprint === fingerprint);
  if (!match || match.samples < 10) return null;

  if (match.failed) {
    return {
      fingerprint,
      winRate: match.winRate,
      samples: match.samples,
      confidenceBoost: -10,
    };
  }

  if (match.winRate >= 60 && match.profitFactor >= 1.2) {
    const boost = Math.min(15, Math.round((match.winRate - 55) / 3));
    return {
      fingerprint,
      winRate: match.winRate,
      samples: match.samples,
      confidenceBoost: boost,
    };
  }

  return null;
}

export function updateSetupLibrary(
  library: StoredSetup[],
  fingerprint: string,
  won: boolean,
  pnl: number,
): StoredSetup[] {
  const idx = library.findIndex((s) => s.fingerprint === fingerprint);
  const existing = idx >= 0 ? library[idx]! : {
    fingerprint,
    winRate: 0,
    profitFactor: 1,
    samples: 0,
  };

  const samples = existing.samples + 1;
  const wins = Math.round((existing.winRate / 100) * existing.samples) + (won ? 1 : 0);
  const winRate = (wins / samples) * 100;
  const grossWin = won ? Math.max(pnl, 0) : existing.profitFactor;
  const profitFactor = won
    ? Math.max(1, existing.profitFactor * 0.9 + (pnl > 0 ? 1.1 : 0.9) * 0.1)
    : existing.profitFactor * 0.95;

  const updated: StoredSetup = {
    fingerprint,
    winRate,
    profitFactor: grossWin || profitFactor,
    samples,
    failed: samples >= 10 && winRate < 35,
  };

  const next = [...library];
  if (idx >= 0) next[idx] = updated;
  else next.push(updated);
  return next.slice(-50);
}
