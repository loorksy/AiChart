/**
 * Persisted instrument catalogue seeded from connected cloud accounts.
 *
 * The owner's Exness account covers essentially every pair any broker offers.
 * Pulling getSymbols() on link fills gaps so a later user linking a different
 * broker still gets a populated list even if their RPC list is slow or empty.
 * Origin is recorded per row; only broker-origin rows are served — rows left
 * behind by the retired platform feed are deliberately invisible.
 */
import { execute, query, queryOne } from "@/lib/db";
import { forexCanonicalKey } from "./forexCanonical";
import {
  resolveBrokerSymbolFromCatalogue,
  type BrokerSymbolCatalogueEntry,
} from "./brokerSymbolResolve";

export type SymbolOrigin = "broker";

export type SymbolCatalogueRow = BrokerSymbolCatalogueEntry & {
  origin: SymbolOrigin;
  seeded_by_user_id: number | null;
  metaapi_account_id: string | null;
  updated_at: string;
};

/** Upsert every symbol the connected account reported. */
export async function seedBrokerSymbols(input: {
  userId: number;
  metaapiAccountId: string;
  symbols: readonly string[];
}): Promise<number> {
  let upserted = 0;
  for (const raw of input.symbols) {
    const broker_symbol = raw.trim();
    if (!broker_symbol) continue;
    const canonical = forexCanonicalKey(broker_symbol);
    await execute(
      `INSERT INTO symbol_catalogue
         (broker_symbol, canonical, origin, seeded_by_user_id, metaapi_account_id, updated_at)
       VALUES (?, ?, 'broker', ?, ?, datetime('now'))
       ON CONFLICT (origin, broker_symbol) DO UPDATE SET
         canonical = excluded.canonical,
         seeded_by_user_id = excluded.seeded_by_user_id,
         metaapi_account_id = excluded.metaapi_account_id,
         updated_at = datetime('now')`,
      [broker_symbol, canonical, input.userId, input.metaapiAccountId],
    );
    upserted += 1;
  }
  return upserted;
}

/** Broker-origin rows — the shared seed list + any account-specific spellings. */
export async function listBrokerCatalogue(opts?: {
  q?: string;
  limit?: number;
}): Promise<SymbolCatalogueRow[]> {
  const limit = Math.min(Math.max(1, opts?.limit ?? 5000), 10_000);
  const q = (opts?.q ?? "").trim();
  if (q) {
    const like = `%${q.replace(/[%_]/g, "")}%`;
    return query<SymbolCatalogueRow>(
      `SELECT broker_symbol, canonical, origin, seeded_by_user_id,
              metaapi_account_id, updated_at
         FROM symbol_catalogue
        WHERE origin = 'broker'
          AND (broker_symbol LIKE ? OR canonical LIKE ?)
        ORDER BY broker_symbol ASC
        LIMIT ?`,
      [like, like.toUpperCase(), limit],
    );
  }
  return query<SymbolCatalogueRow>(
    `SELECT broker_symbol, canonical, origin, seeded_by_user_id,
            metaapi_account_id, updated_at
       FROM symbol_catalogue
      WHERE origin = 'broker'
      ORDER BY broker_symbol ASC
      LIMIT ?`,
    [limit],
  );
}

/** Resolve outbound broker spelling for a user from the persisted catalogue. */
export async function resolveBrokerSymbol(
  userId: number,
  canonicalOrRaw: string,
): Promise<string> {
  void userId;
  // Catalogue is shared across users (N7: fill gaps for later linkers). A
  // per-user filter would hide the owner's Exness seed from everyone else.
  const rows = await query<BrokerSymbolCatalogueEntry>(
    `SELECT broker_symbol, canonical
       FROM symbol_catalogue
      WHERE origin = 'broker'
        AND (canonical = ? OR broker_symbol = ?)
      ORDER BY updated_at DESC
      LIMIT 50`,
    [forexCanonicalKey(canonicalOrRaw), canonicalOrRaw.trim()],
  );
  // Also pull a broader match set when the exact canonical miss — brokers
  // sometimes report spellings whose leading six letters differ after fold.
  if (rows.length === 0) {
    const all = await query<BrokerSymbolCatalogueEntry>(
      `SELECT broker_symbol, canonical
         FROM symbol_catalogue
        WHERE origin = 'broker'
        LIMIT 5000`,
    );
    return resolveBrokerSymbolFromCatalogue(canonicalOrRaw, all);
  }
  return resolveBrokerSymbolFromCatalogue(canonicalOrRaw, rows);
}

/** Parse favourites JSON; preserve broker case; drop empties. */
export function parseFavouriteSymbols(raw: unknown): string[] {
  if (typeof raw !== "string" || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: string[] = [];
    const seen = new Set<string>();
    for (const item of parsed) {
      if (typeof item !== "string") continue;
      const sym = item.trim();
      if (!sym) continue;
      // Deduplicate by comparison fold so XAUUSD and XAUUSDm cannot both pin.
      const key = sym.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(sym);
      if (out.length >= 40) break;
    }
    return out;
  } catch {
    return [];
  }
}

export async function getFavouriteSymbols(userId: number): Promise<string[]> {
  const row = await queryOne<{ favourite_symbols: string | null }>(
    `SELECT favourite_symbols FROM trading_settings WHERE user_id = ?`,
    [userId],
  );
  return parseFavouriteSymbols(row?.favourite_symbols);
}

export async function setFavouriteSymbols(
  userId: number,
  symbols: readonly string[],
): Promise<string[]> {
  const cleaned = parseFavouriteSymbols(JSON.stringify(symbols));
  await execute(
    `UPDATE trading_settings
        SET favourite_symbols = ?, updated_at = datetime('now')
      WHERE user_id = ?`,
    [JSON.stringify(cleaned), userId],
  );
  return cleaned;
}

export async function toggleFavouriteSymbol(
  userId: number,
  symbol: string,
): Promise<{ favourites: string[]; favourite: boolean }> {
  const sym = symbol.trim();
  const current = await getFavouriteSymbols(userId);
  const key = sym.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  const idx = current.findIndex(
    (s) => s.replace(/[^A-Za-z0-9]/g, "").toUpperCase() === key,
  );
  let next: string[];
  let favourite: boolean;
  if (idx >= 0) {
    next = current.filter((_, i) => i !== idx);
    favourite = false;
  } else {
    next = [sym, ...current].slice(0, 40);
    favourite = true;
  }
  await setFavouriteSymbols(userId, next);
  return { favourites: next, favourite };
}
