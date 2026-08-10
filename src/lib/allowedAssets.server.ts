import type { MarketType } from "./markets/types";
import { forexCanonicalKey } from "./markets/forexCanonical";
import { TRADABLE_SYMBOLS } from "./markets/forexInstruments";
import {
  MONITOR_TOP_SYMBOL_LIMIT,
  isOpenAssetsPolicy,
  parseAllowedAssets,
  parseWatchlist,
  resolveScanAssets,
} from "./allowedAssets";

const TRADABLE_SET = new Set(TRADABLE_SYMBOLS.map((s) => forexCanonicalKey(s)));

/** Hard allowlist intersection — never returns a symbol outside the fixed 20-instrument universe. */
function restrictToTradableUniverse(symbols: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of symbols) {
    const key = forexCanonicalKey(raw);
    if (!TRADABLE_SET.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

/**
 * Server-only scan resolver. The forex universe is the fixed 20-instrument
 * allowlist in `markets/forexInstruments.ts` — a hard cap, not a hint. Any
 * watchlist/allow-list/catalogue-derived symbol outside that set is dropped
 * here rather than passed through.
 */
export async function resolveScanAssetsForMarket(
  raw: string,
  market: MarketType,
  _userId: number,
  topLimit = MONITOR_TOP_SYMBOL_LIMIT,
): Promise<string[]> {
  if (market === "forex") {
    const watchlist = parseWatchlist(raw);
    if (watchlist.length > 0) {
      return restrictToTradableUniverse(watchlist).slice(0, topLimit);
    }
    if (isOpenAssetsPolicy(raw, "forex")) {
      const allowed = parseAllowedAssets(raw, "forex");
      if (allowed.length > 0) return restrictToTradableUniverse(allowed).slice(0, topLimit);
      return restrictToTradableUniverse([...TRADABLE_SYMBOLS]).slice(0, topLimit);
    }
    return restrictToTradableUniverse(parseAllowedAssets(raw, "forex")).slice(0, topLimit);
  }
  return resolveScanAssets(raw, topLimit);
}
