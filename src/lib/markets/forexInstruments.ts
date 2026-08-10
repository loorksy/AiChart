export interface ForexInstrument {
  symbol: string;
  base: string;
  quote: string;
  group: "major" | "minor" | "metal" | "crypto";
}

/**
 * The platform's entire tradable universe — exactly these 20 instruments,
 * a hard allowlist, not a baseline. Every symbol-surfacing endpoint (scan
 * resolver, /api/instruments, the chart symbol picker) filters down to this
 * list; nothing outside it is fetched, quoted, or offered for analysis.
 */
export const FOREX_INSTRUMENTS: ForexInstrument[] = [
  // Majors
  { symbol: "EURUSD", base: "EUR", quote: "USD", group: "major" },
  { symbol: "GBPUSD", base: "GBP", quote: "USD", group: "major" },
  { symbol: "USDJPY", base: "USD", quote: "JPY", group: "major" },
  { symbol: "USDCHF", base: "USD", quote: "CHF", group: "major" },
  { symbol: "AUDUSD", base: "AUD", quote: "USD", group: "major" },
  { symbol: "USDCAD", base: "USD", quote: "CAD", group: "major" },
  { symbol: "NZDUSD", base: "NZD", quote: "USD", group: "major" },
  // Minors / crosses
  { symbol: "EURJPY", base: "EUR", quote: "JPY", group: "minor" },
  { symbol: "GBPJPY", base: "GBP", quote: "JPY", group: "minor" },
  { symbol: "EURGBP", base: "EUR", quote: "GBP", group: "minor" },
  { symbol: "AUDJPY", base: "AUD", quote: "JPY", group: "minor" },
  { symbol: "EURAUD", base: "EUR", quote: "AUD", group: "minor" },
  { symbol: "GBPAUD", base: "GBP", quote: "AUD", group: "minor" },
  { symbol: "EURCHF", base: "EUR", quote: "CHF", group: "minor" },
  { symbol: "CADJPY", base: "CAD", quote: "JPY", group: "minor" },
  { symbol: "NZDJPY", base: "NZD", quote: "JPY", group: "minor" },
  { symbol: "AUDCHF", base: "AUD", quote: "CHF", group: "minor" },
  { symbol: "GBPNZD", base: "GBP", quote: "NZD", group: "minor" },
  // Metal
  { symbol: "XAUUSD", base: "XAU", quote: "USD", group: "metal" },
  // Crypto
  { symbol: "BTCUSD", base: "BTC", quote: "USD", group: "crypto" },
];

/** The fixed 20-symbol universe, canonical spellings only. */
export const TRADABLE_SYMBOLS: readonly string[] = FOREX_INSTRUMENTS.map((i) => i.symbol);

/**
 * Alias kept for traceability with the platform's env-var naming convention.
 * There is currently no live candle-sync/warehouse job (deleted earlier —
 * every candle is fetched live, no persistence) so this constant today backs
 * only the scan-universe resolver and symbol-surfacing endpoints; it is
 * defined here so a future sync job has one place to read the allowlist from.
 */
export const CANDLE_SYNC_SYMBOLS: readonly string[] = TRADABLE_SYMBOLS;

const FOREX_SET = new Set(FOREX_INSTRUMENTS.map((i) => i.symbol));

export function isKnownForexSymbol(symbol: string): boolean {
  return FOREX_SET.has(symbol.toUpperCase().replace(/[\s/_-]+/g, ""));
}

/** Splits a raw broker symbol into base/quote for display (best effort). */
export function forexBaseQuote(symbol: string): { base: string; quote: string } {
  const clean = symbol.toUpperCase().replace(/[\s/_-]+/g, "");
  const known = FOREX_INSTRUMENTS.find((i) => clean.startsWith(i.symbol));
  if (known) return { base: known.base, quote: known.quote };
  if (/^[A-Z]{6}/.test(clean)) {
    return { base: clean.slice(0, 3), quote: clean.slice(3, 6) };
  }
  return { base: clean, quote: "" };
}

/** Filters the baseline list by a free-text query (includes canonical match). */
export function searchForexInstruments(q: string): ForexInstrument[] {
  const query = q.trim().toUpperCase();
  if (!query) return FOREX_INSTRUMENTS;
  const canonical = query.length >= 3 ? query.slice(0, 6) : query;
  return FOREX_INSTRUMENTS.filter(
    (i) =>
      i.symbol.includes(query) ||
      i.base.includes(query) ||
      i.quote.includes(query) ||
      i.symbol.startsWith(canonical),
  );
}
