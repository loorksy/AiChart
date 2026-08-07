/**
 * Stable symbol mapping — ONE place that answers "what is this instrument
 * called" per subsystem:
 *   canonical — platform-wide compact key (EURUSD, XAUUSD): warehouse, cache,
 *               recommendations. Matches forexCanonicalKey used everywhere.
 *   display   — human form (EUR/USD).
 *   mt5       — broker symbol for MT5 execution. Static best-effort here
 *               (env override per symbol); a linked broker's own suffixed
 *               spelling (EURUSDm) is read from its live symbol catalogue,
 *               not from this mapping.
 */
import { forexCanonicalKey } from "./forexCanonical";

export interface SymbolMapping {
  canonical: string;
  display: string;
  mt5: string;
}

/** EURUSD → EUR/USD. Non 6-letter symbols pass through unchanged. */
function toDisplayPair(compact: string): string {
  return /^[A-Z]{6}$/.test(compact)
    ? `${compact.slice(0, 3)}/${compact.slice(3)}`
    : compact;
}

/**
 * Normalize any raw symbol form (EURUSD, EUR_USD, EUR/USD, EURUSDm,
 * XAUUSD.pro) into the full mapping.
 */
export function normalizeSymbol(raw: string): SymbolMapping {
  const canonical = forexCanonicalKey(raw);
  const envOverride = process.env[`MT5_${canonical}_SYMBOL`];
  return {
    canonical,
    display: toDisplayPair(canonical),
    mt5: envOverride || canonical,
  };
}

/** Base/quote currencies affected by news for a canonical symbol. */
export function affectedCurrencies(symbol: string): string[] {
  const s = forexCanonicalKey(symbol);
  if (s.includes("XAU") || s.includes("GOLD")) return ["XAU", "USD"];
  if (s.length >= 6) return [s.slice(0, 3), s.slice(3, 6)];
  return s ? [s] : [];
}
