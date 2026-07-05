/** Broker suffixes (EURUSDm, XAUUSDM, XAUUSD.pro) → OANDA 6-letter key. */
export function toOandaForexSymbol(symbol: string): string {
  const alnum = symbol.replace(/[^A-Za-z0-9]/g, "");
  return alnum.length >= 6 ? alnum.slice(0, 6).toUpperCase() : alnum.toUpperCase();
}

/** True when the raw broker ticker differs from the OANDA instrument key. */
export function isBrokerForexSuffix(symbol: string): boolean {
  const raw = symbol.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  return raw.length > 6 || raw !== toOandaForexSymbol(symbol);
}
