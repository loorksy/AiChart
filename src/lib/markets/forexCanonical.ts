/** First 6 letters of a forex/CFD symbol (EURUSDm → EURUSD, XAUUSD.pro → XAUUSD). */
export function forexCanonicalKey(symbol: string): string {
  const alnum = symbol.replace(/[^A-Za-z0-9]/g, "");
  return alnum.length >= 6 ? alnum.slice(0, 6).toUpperCase() : alnum.toUpperCase();
}
