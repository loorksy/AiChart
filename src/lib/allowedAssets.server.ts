import type { MarketType } from "./markets/types";
import { listBrokerCatalogue } from "./markets/symbolCatalogue";
import { forexCanonicalKey } from "./markets/forexCanonical";
import {
  MONITOR_TOP_SYMBOL_LIMIT,
  isOpenAssetsPolicy,
  parseAllowedAssets,
  parseWatchlist,
  resolveScanAssets,
} from "./allowedAssets";

/**
 * Server-only scan resolver. The forex universe comes exclusively from the
 * broker-seeded symbol catalogue (populated from linked MetaTrader accounts);
 * when it is empty the resolver returns [] so callers surface a setup state —
 * never a substitute feed.
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
      try {
        const rows = await listBrokerCatalogue({ limit: 5000 });
        const seen = new Set<string>();
        const fx: string[] = [];
        for (const row of rows) {
          const key = forexCanonicalKey(row.broker_symbol);
          if (seen.has(key)) continue;
          seen.add(key);
          fx.push(key);
        }
        if (fx.length > 0) return fx.slice(0, topLimit);
      } catch {
        /* empty */
      }
      return [];
    }
    return parseAllowedAssets(raw, "forex").slice(0, topLimit);
  }
  return resolveScanAssets(raw, topLimit);
}
