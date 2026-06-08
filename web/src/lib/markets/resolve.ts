import type { ResolvedSymbol } from "./types";

/** Normalizes user input to a Binance spot USDT pair (e.g. BTC → BTCUSDT). */
export function resolveSymbol(query: string): ResolvedSymbol {
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

export function marketLabel(): string {
  return "عملات رقمية (Binance Spot)";
}
