import type { MarketType } from "./markets/types";
import { fetchOandaInstruments, oandaConfigured, oandaAccountId } from "./markets/oanda";
import {
  MONITOR_TOP_SYMBOL_LIMIT,
  isOpenAssetsPolicy,
  parseAllowedAssets,
  parseWatchlist,
  resolveScanAssets,
} from "./allowedAssets";

/**
 * Server-only scan resolver. Forex universe comes exclusively from OANDA when
 * configured; otherwise returns [] so callers surface a setup state.
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
      return watchlist.slice(0, topLimit);
    }
    if (isOpenAssetsPolicy(raw, "forex")) {
      const allowed = parseAllowedAssets(raw, "forex");
      if (allowed.length > 0) return allowed.slice(0, topLimit);
      if (oandaConfigured() && oandaAccountId()) {
        try {
          const oanda = await fetchOandaInstruments();
          const fx = oanda
            .filter((i) => i.type === "CURRENCY" || i.type === "METAL")
            .map((i) => i.symbol);
          if (fx.length > 0) return fx.slice(0, topLimit);
        } catch {
          /* empty */
        }
      }
      return [];
    }
    return parseAllowedAssets(raw, "forex").slice(0, topLimit);
  }
  return resolveScanAssets(raw, topLimit);
}
