import type { MarketType, ResolvedSymbol } from "./types";
import { getForexBackend } from "../brokers/forexBackend";

/** Normalizes a crypto symbol to a Binance spot USDT pair (e.g. BTC → BTCUSDT). */
function resolveCrypto(query: string): ResolvedSymbol {
  const raw = query.trim().toUpperCase();
  if (!raw) {
    return {
      raw: query,
      symbol: "BTCUSDT",
      market: "crypto",
      displayName: "BTC/USDT",
    };
  }

  let sym = raw.replace(/[^A-Z0-9]/g, "");
  if (sym.endsWith("USDC") || sym.endsWith("BUSD")) {
    sym = `${sym.slice(0, -4)}USDT`;
  } else if (!sym.endsWith("USDT")) {
    sym = sym.replace(/USD$/i, "");
    if (!sym.endsWith("USDT")) sym = `${sym}USDT`;
  }

  const base = sym.slice(0, -4);
  return {
    raw: query,
    symbol: sym,
    market: "crypto",
    displayName: `${base}/USDT`,
  };
}

/**
 * Normalizes a forex symbol (e.g. "EUR/USD" → "EURUSD", "xauusd" → "XAUUSD").
 * Broker-specific suffixes (EURUSDm, EURUSD.pro) are preserved as-is after the
 * separators are stripped, since the EA matches against the broker's symbols.
 */
function resolveForex(query: string): ResolvedSymbol {
  const raw = query.trim().toUpperCase();
  if (!raw) {
    return { raw: query, symbol: "EURUSD", market: "forex", displayName: "EUR/USD" };
  }
  const sym = raw.replace(/[\s/_-]+/g, "");
  // Pretty display for the canonical 6-letter pairs (e.g. EURUSD → EUR/USD).
  const display =
    /^[A-Z]{6}$/.test(sym) ? `${sym.slice(0, 3)}/${sym.slice(3)}` : sym;
  return { raw: query, symbol: sym, market: "forex", displayName: display };
}

/** Normalizes user input to a broker symbol for the given market. */
export function resolveSymbol(
  query: string,
  market: MarketType = "crypto",
): ResolvedSymbol {
  return market === "forex" ? resolveForex(query) : resolveCrypto(query);
}

export function marketLabel(market: MarketType = "crypto"): string {
  if (market !== "forex") return "عملات رقمية (Binance Spot)";
  return getForexBackend() === "metaapi"
    ? "فوركس (MetaTrader · MetaApi)"
    : "فوركس (MetaTrader · EA)";
}
