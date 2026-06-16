import { getEaConnection, parseEaSymbolSpecs } from "./eaStore";

/** Common Binance spot → MT5 CFD symbol aliases. */
const CRYPTO_ALIASES: Record<string, string[]> = {
  BTCUSDT: ["BTCUSD", "BTCUSDT", "XBTUSD"],
  ETHUSDT: ["ETHUSD", "ETHUSDT"],
  BNBUSDT: ["BNBUSD", "BNBUSDT"],
  SOLUSDT: ["SOLUSD", "SOLUSDT"],
  XRPUSDT: ["XRPUSD", "XRPUSDT"],
  DOGEUSDT: ["DOGEUSD", "DOGEUSDT"],
  ADAUSDT: ["ADAUSD", "ADAUSDT"],
  LTCUSDT: ["LTCUSD", "LTCUSDT"],
};

/** First 6 letters of a forex/CFD symbol (EURUSDm → EURUSD, XAUUSD.pro → XAUUSD). */
export function forexCanonicalKey(symbol: string): string {
  const alnum = symbol.replace(/[^A-Za-z0-9]/g, "");
  return alnum.length >= 6 ? alnum.slice(0, 6).toUpperCase() : alnum.toUpperCase();
}

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
 * Maps a platform symbol (BTCUSDT, EURUSD) to the broker MT5 symbol name.
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

  // 1) Exact match (preserves API-provided case)
  if (available.includes(query)) return query;

  // 2) Case-insensitive match → broker's exact case
  const ci = findCaseInsensitive(available, query);
  if (ci) return ci;

  // 3) Forex canonical base (EURUSD → EURUSDm, XAUUSD → XAUUSDm)
  const canonical = findByForexCanonical(available, query);
  if (canonical) return canonical;

  // 4) Crypto aliases
  const upper = query.toUpperCase();
  const aliases = CRYPTO_ALIASES[upper] ?? [];
  for (const alias of aliases) {
    const match = findCaseInsensitive(available, alias);
    if (match) return match;
  }

  if (upper.endsWith("USDT")) {
    const baseUsd = `${upper.slice(0, -4)}USD`;
    const match =
      findCaseInsensitive(available, baseUsd) ??
      findByForexCanonical(available, baseUsd);
    if (match) return match;
  }

  return null;
}
