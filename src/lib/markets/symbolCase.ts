/**
 * Case handling for instrument symbols.
 *
 * The platform feed uses canonical uppercase keys (EURUSD, XAUUSD). A broker
 * uses its OWN spelling, and that spelling is case-sensitive: Exness serves
 * XAUUSDm, EURUSDm, AAPLm. Folding those to uppercase asks MetaApi for an
 * instrument that does not exist, and the request comes back "Symbol XAUUSDM
 * does not exist" after a long retry.
 *
 * A lowercase letter is the tell. Canonical keys never carry one, so keeping a
 * symbol that has one is safe for the platform feed and necessary for a broker.
 */
export function normalizeSymbolCase(symbol: string): string {
  const s = symbol.trim();
  return /[a-z]/.test(s) ? s : s.toUpperCase();
}

/** True when the symbol came from a broker catalogue rather than the platform. */
export function isBrokerSpelledSymbol(symbol: string): boolean {
  return /[a-z]/.test(symbol.trim());
}
