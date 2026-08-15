import {
  BASE_CURRENCY,
  DATA_SYMBOL,
  DISPLAY_NAME_AR,
  DISPLAY_NAME_EN,
  QUOTE_CURRENCY,
  isGold,
} from "@/lib/gold";

export interface ForexInstrument {
  symbol: string;
  base: string;
  quote: string;
  group: "metal";
  labelAr: string;
  labelEn: string;
}

/**
 * The platform's entire instrument universe: gold, alone.
 *
 * Kept as a one-element list rather than collapsed to a scalar so the
 * surfaces that iterate instruments (catalogue endpoint, any future
 * multi-row UI) keep their shape without special-casing. The single source
 * of truth for the symbol itself is lib/gold.ts.
 */
export const FOREX_INSTRUMENTS: ForexInstrument[] = [
  {
    symbol: DATA_SYMBOL,
    base: BASE_CURRENCY,
    quote: QUOTE_CURRENCY,
    group: "metal",
    labelAr: DISPLAY_NAME_AR,
    labelEn: DISPLAY_NAME_EN,
  },
];

/** The instrument universe, canonical spelling. One entry, always. */
export const TRADABLE_SYMBOLS: readonly string[] = [DATA_SYMBOL];

export function isKnownForexSymbol(symbol: string): boolean {
  return isGold(symbol);
}

/** Splits a symbol into base/quote for display. Only gold resolves. */
export function forexBaseQuote(symbol: string): { base: string; quote: string } {
  if (isGold(symbol)) return { base: BASE_CURRENCY, quote: QUOTE_CURRENCY };
  return { base: symbol.toUpperCase(), quote: "" };
}
