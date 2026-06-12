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

/** Symbols reported by the EA in its latest heartbeat. */
export async function getEaSymbolSet(userId: number): Promise<Set<string>> {
  const conn = await getEaConnection(userId);
  if (!conn) return new Set();
  const specs = parseEaSymbolSpecs(conn.symbol_specs_json);
  return new Set(specs.map((s) => s.symbol?.toUpperCase()).filter(Boolean) as string[]);
}

/**
 * Maps a platform symbol (BTCUSDT, EURUSD) to the broker MT5 symbol name.
 * Uses direct match first, then crypto aliases, then {BASE}USD from USDT pairs.
 */
export async function resolveMt5Symbol(
  userId: number,
  symbol: string,
): Promise<string | null> {
  const upper = symbol.trim().toUpperCase();
  if (!upper) return null;

  const available = await getEaSymbolSet(userId);
  if (available.size === 0) return null;

  if (available.has(upper)) return upper;

  const aliases = CRYPTO_ALIASES[upper] ?? [];
  for (const alias of aliases) {
    if (available.has(alias)) return alias;
  }

  if (upper.endsWith("USDT")) {
    const baseUsd = `${upper.slice(0, -4)}USD`;
    if (available.has(baseUsd)) return baseUsd;
  }

  return null;
}
