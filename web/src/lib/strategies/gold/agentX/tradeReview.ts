/**
 * Gold Agent X — post-trade review.
 */
import type { CouncilResult, DangerLevel, MarketContext, RegimeInfo, TradeJournalEntry } from "./types";
import { fingerprintSetup } from "./setupLibrary";
import type { GoldSide } from "../goldTypes";

export interface ClosedTradeInput {
  botId: number;
  userId: number;
  side: GoldSide;
  entryPrice: number;
  exitPrice: number;
  lot: number;
  pnl: number;
  ctx: MarketContext;
  regime: RegimeInfo;
  council: CouncilResult;
  weights: Record<string, number>;
  confidence: number;
  tradeQuality: number;
  tradeScore: number;
  dangerLevel: DangerLevel;
  exitReason: string;
  entryAt: number;
  exitAt: number;
}

export function buildTradeReview(input: ClosedTradeInput): TradeJournalEntry {
  return {
    botId: input.botId,
    userId: input.userId,
    side: input.side,
    entryPrice: input.entryPrice,
    exitPrice: input.exitPrice,
    lot: input.lot,
    pnl: input.pnl,
    regime: input.regime.dominant,
    session: input.ctx.session.session,
    confidence: input.confidence,
    tradeQuality: input.tradeQuality,
    tradeScore: input.tradeScore,
    dangerLevel: input.dangerLevel,
    advisorVotes: input.council.votes,
    weights: input.weights,
    exitReason: input.exitReason,
    durationMs: input.exitAt - input.entryAt,
    fingerprint: fingerprintSetup(input.ctx, input.regime, input.council),
  };
}

export function summarizeTrade(entry: TradeJournalEntry): string {
  const outcome = entry.pnl >= 0 ? "ربح" : "خسارة";
  return `${outcome} ${entry.pnl.toFixed(2)} · ${entry.regime} · ${entry.exitReason}`;
}
