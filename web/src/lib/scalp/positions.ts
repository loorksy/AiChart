import { createIntent, listOpenTrades } from "../store";
import { closeOpenTrade, type CloseTradeResult } from "../tradeClose";
import { executeIntent, type ExecutionResult } from "../execution";
import type { MarketType } from "../markets/types";
import type { Trade } from "../types";

/**
 * Symbol-oriented position helpers for the scalp loop. These compose the
 * existing gated primitives — `closeOpenTrade` (per-broker close) and
 * `executeIntent` (Risk Guard authority) — so the scalp engine never needs a
 * trade id and never bypasses risk checks.
 */

function sameSymbol(a: string, b: string): boolean {
  return a.replace(/[^a-z0-9]/gi, "").toUpperCase() ===
    b.replace(/[^a-z0-9]/gi, "").toUpperCase();
}

/** Open trades for a user matching `symbol` (broker-suffix tolerant). */
export async function findOpenTradesBySymbol(
  userId: number,
  symbol: string,
): Promise<Trade[]> {
  const open = await listOpenTrades(userId, 200);
  return open.filter((t) => sameSymbol(t.symbol, symbol));
}

/** Closes every open trade for a symbol. Returns one result per trade. */
export async function closePositionBySymbol(
  userId: number,
  symbol: string,
): Promise<CloseTradeResult[]> {
  const trades = await findOpenTradesBySymbol(userId, symbol);
  const results: CloseTradeResult[] = [];
  for (const t of trades) {
    results.push(await closeOpenTrade(userId, t.id));
  }
  return results;
}

export interface ReverseContext {
  symbol: string;
  /** The side to be holding AFTER the reverse. */
  newSide: "buy" | "sell";
  notional: number;
  market?: MarketType;
  entry?: number | null;
  stop_loss?: number | null;
  take_profit?: number | null;
  confidence?: number;
  explicitApproval?: boolean;
  practiceMode?: boolean;
}

export interface ReverseResult {
  closed: CloseTradeResult[];
  opened: ExecutionResult | null;
}

/**
 * Flips a position: closes any open trades for the symbol, then opens the
 * opposite side through the risk-gated execution path. If the new entry is
 * denied by Risk Guard, the close still stands and `opened.ok` is false.
 */
export async function reversePosition(
  userId: number,
  ctx: ReverseContext,
): Promise<ReverseResult> {
  const closed = await closePositionBySymbol(userId, ctx.symbol);

  const intent = await createIntent(userId, {
    symbol: ctx.symbol,
    side: ctx.newSide,
    notional: ctx.notional,
    market: ctx.market,
    entry: ctx.entry ?? null,
    stop_loss: ctx.stop_loss ?? null,
    take_profit: ctx.take_profit ?? null,
    confidence: ctx.confidence ?? 0,
    status: "approved",
  });

  const opened = await executeIntent(userId, intent.id, {
    explicitApproval: ctx.explicitApproval ?? true,
    practiceMode: ctx.practiceMode,
  });

  return { closed, opened };
}
