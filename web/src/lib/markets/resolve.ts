import { DEFAULT_MARKET } from "../marketPolicy";
import type { MarketType, ResolvedSymbol } from "./types";
import { getForexBackend } from "../brokers/forexBackend";

/**
 * Normalizes a forex symbol (e.g. "EUR/USD" → "EURUSD", "xauusd" → "XAUUSD").
 * Broker-specific suffixes (EURUSDm, EURUSD.pro) are preserved as-is after the
 * separators are stripped, since the EA matches against the broker's symbols.
 */
function resolveForex(query: string): ResolvedSymbol {
  const trimmed = query.trim();
  if (!trimmed) {
    return { raw: query, symbol: "EURUSD", market: "forex", displayName: "EUR/USD" };
  }
  const sym = trimmed.replace(/[\s/_-]+/g, "");
  const symUpper = sym.toUpperCase();
  // Pretty display for the canonical 6-letter pairs (e.g. EURUSD → EUR/USD).
  const display =
    /^[A-Za-z]{6}$/.test(sym) ? `${symUpper.slice(0, 3)}/${symUpper.slice(3)}` : sym;
  return { raw: query, symbol: sym, market: "forex", displayName: display };
}

/** Normalizes user input to a broker symbol for forex. */
export function resolveSymbol(
  query: string,
  market: MarketType = DEFAULT_MARKET,
): ResolvedSymbol {
  void market;
  return resolveForex(query);
}

/** Intent/recommendation symbol: preserve broker suffix case for forex. */
export function normalizeIntentSymbol(
  symbol: string,
  _market: MarketType = DEFAULT_MARKET,
): string {
  return symbol.trim().replace(/[\s/_-]+/g, "");
}

export function marketLabel(_market: MarketType = DEFAULT_MARKET): string {
  return getForexBackend() === "metaapi"
    ? "فوركس (MetaTrader · MetaApi)"
    : "فوركس (MetaTrader · EA)";
}
