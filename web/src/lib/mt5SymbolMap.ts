import { getEaConnection, parseEaSymbolSpecs } from "./eaStore";
import { forexCanonicalKey } from "./markets/forexCanonical";

/** First 6 letters of a forex symbol (EURUSDm → EURUSD, XAUUSD.pro → XAUUSD). */
export { forexCanonicalKey } from "./markets/forexCanonical";

/** Symbols reported by the EA in its latest heartbeat (broker-exact case). */
export async function getEaSymbolList(userId: number): Promise<string[]> {
  const conn = await getEaConnection(userId);
  if (!conn) return [];
  const specs = parseEaSymbolSpecs(conn.symbol_specs_json);
  return specs.map((s) => s.symbol?.trim()).filter(Boolean) as string[];
}

/** @deprecated Use getEaSymbolList — uppercase keys only, loses broker suffix case. */
export async function getEaSymbolSet(userId: number): Promise<Set<string>> {
  const list = await getEaSymbolList(userId);
  return new Set(list.map((s) => s.toUpperCase()));
}

function findCaseInsensitive(symbols: string[], query: string): string | null {
  const q = query.toUpperCase();
  return symbols.find((s) => s.toUpperCase() === q) ?? null;
}

function findByForexCanonical(symbols: string[], query: string): string | null {
  const key = forexCanonicalKey(query);
  if (!key) return null;
  return symbols.find((s) => forexCanonicalKey(s) === key) ?? null;
}

/** Comma-separated hint for error messages (preserves broker case). */
export function formatEaSymbolHint(symbols: string[], max = 20): string {
  if (symbols.length === 0) return "(none)";
  const shown = symbols.slice(0, max);
  const suffix = symbols.length > max ? ` … +${symbols.length - max} more` : "";
  return shown.join(", ") + suffix;
}

/**
 * Maps a platform symbol (EURUSD, XAUUSD) to the broker MT5 symbol name.
 * Returns the exact case from the EA heartbeat (e.g. EURUSDm, not EURUSDM).
 */
export async function resolveMt5Symbol(
  userId: number,
  symbol: string,
): Promise<string | null> {
  const query = symbol.trim();
  if (!query) return null;

  const available = await getEaSymbolList(userId);
  if (available.length === 0) return null;

  if (available.includes(query)) return query;

  const ci = findCaseInsensitive(available, query);
  if (ci) return ci;

  return findByForexCanonical(available, query);
}
