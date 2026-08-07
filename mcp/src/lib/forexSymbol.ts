/** Broker suffixes (EURUSDm, XAUUSDM, XAUUSD.pro) → canonical 6-letter key (XAUUSD). */
export function toCanonicalForexSymbol(symbol: string): string {
  const alnum = symbol.replace(/[^A-Za-z0-9]/g, "");
  return alnum.length >= 6 ? alnum.slice(0, 6).toUpperCase() : alnum.toUpperCase();
}

/** True when the raw broker ticker differs from the canonical instrument key. */
export function isBrokerForexSuffix(symbol: string): boolean {
  const raw = symbol.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  return raw.length > 6 || raw !== toCanonicalForexSymbol(symbol);
}
