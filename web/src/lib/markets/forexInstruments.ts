export interface ForexInstrument {
  symbol: string;
  base: string;
  quote: string;
  group: "major" | "minor" | "metal" | "index" | "energy";
}

/**
 * Common MetaTrader forex / CFD instruments. Brokers often add suffixes
 * (e.g. EURUSDm, XAUUSD.pro); those extra symbols are merged at runtime from
 * the user's EA `symbol_specs` heartbeat, so this static list is a baseline.
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
  { symbol: "EURGBP", base: "EUR", quote: "GBP", group: "minor" },
  { symbol: "EURJPY", base: "EUR", quote: "JPY", group: "minor" },
  { symbol: "GBPJPY", base: "GBP", quote: "JPY", group: "minor" },
  { symbol: "EURCHF", base: "EUR", quote: "CHF", group: "minor" },
  { symbol: "AUDJPY", base: "AUD", quote: "JPY", group: "minor" },
  { symbol: "CADJPY", base: "CAD", quote: "JPY", group: "minor" },
  { symbol: "EURAUD", base: "EUR", quote: "AUD", group: "minor" },
  { symbol: "GBPAUD", base: "GBP", quote: "AUD", group: "minor" },
  // Metals
  { symbol: "XAUUSD", base: "XAU", quote: "USD", group: "metal" },
  { symbol: "XAGUSD", base: "XAG", quote: "USD", group: "metal" },
  // Energy
  { symbol: "USOIL", base: "USOIL", quote: "USD", group: "energy" },
  { symbol: "UKOIL", base: "UKOIL", quote: "USD", group: "energy" },
  // Indices (common CFD names)
  { symbol: "US30", base: "US30", quote: "USD", group: "index" },
  { symbol: "US500", base: "US500", quote: "USD", group: "index" },
  { symbol: "NAS100", base: "NAS100", quote: "USD", group: "index" },
  { symbol: "GER40", base: "GER40", quote: "EUR", group: "index" },
];

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
