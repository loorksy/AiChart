/**
 * Per-user Watchlist store for Quant Agent Chat's right rail (plan "Feature
 * A — Watchlist + AI Scheduled Monitors" §A2). Deliberately its own file
 * under `lib/quantAgent/` — NOT added to `lib/store.ts`, which is
 * Lonora-scoped — mirroring the isolation `chatStore.ts` already established
 * for Quant Agent Chat (agentId-scoped, never crossing into Lonora's tables).
 *
 * Backend-agnostic: uses the unified db layer (SQLite/Postgres) with `?`
 * placeholders (adaptSql rewrites them for Postgres). Every read/write is
 * scoped by userId so one tenant can never see or touch another's watchlist.
 */
import { execute, query, queryOne } from "@/lib/db";

export interface WatchlistItem {
  id: number;
  userId: number;
  symbol: string;
  market: string;
  createdAt: number;
}

interface WatchlistDbRow {
  id: number;
  user_id: number;
  symbol: string;
  market: string;
  created_at: number;
}

function toItem(row: WatchlistDbRow): WatchlistItem {
  return {
    id: Number(row.id),
    userId: Number(row.user_id),
    symbol: row.symbol,
    market: row.market,
    createdAt: Number(row.created_at),
  };
}

/** Same shape the market routes already normalize incoming symbols to. */
export function normalizeWatchlistSymbol(symbol: string): string {
  return symbol.trim().replace(/[^A-Za-z0-9._]/g, "").toUpperCase();
}

/** Lists a user's watchlist, most recently added first. */
export async function listWatchlist(userId: number): Promise<WatchlistItem[]> {
  const rows = await query<WatchlistDbRow>(
    "SELECT * FROM quant_agent_watchlist_items WHERE user_id = ? ORDER BY created_at DESC",
    [userId],
  );
  return rows.map(toItem);
}

/**
 * Adds a symbol to the user's watchlist. Idempotent: re-adding a symbol
 * already tracked (same user/symbol/market) is a no-op that returns the
 * existing row rather than erroring or duplicating it.
 */
export async function addToWatchlist(
  userId: number,
  symbol: string,
  market = "forex",
): Promise<WatchlistItem> {
  const normalizedSymbol = normalizeWatchlistSymbol(symbol);
  if (!normalizedSymbol) throw new Error("رمز غير صالح.");
  const now = Date.now();
  await execute(
    `INSERT INTO quant_agent_watchlist_items (user_id, symbol, market, created_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (user_id, symbol, market) DO NOTHING`,
    [userId, normalizedSymbol, market, now],
  );
  const row = await queryOne<WatchlistDbRow>(
    "SELECT * FROM quant_agent_watchlist_items WHERE user_id = ? AND symbol = ? AND market = ?",
    [userId, normalizedSymbol, market],
  );
  // The row always exists here: either this call inserted it, or the ON
  // CONFLICT no-op means a prior call already did.
  return toItem(row!);
}

/** Removes a watchlist row the user owns. Returns false if it wasn't theirs. */
export async function removeFromWatchlist(userId: number, id: number): Promise<boolean> {
  const res = await execute(
    "DELETE FROM quant_agent_watchlist_items WHERE id = ? AND user_id = ?",
    [id, userId],
  );
  return res.changes > 0;
}
