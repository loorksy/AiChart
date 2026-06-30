import type { MarketType } from "./markets/types";
import { listBrokerSymbols } from "./eaStore";
import { fetchOandaInstruments, oandaConfigured } from "./markets/oanda";
import {
  MONITOR_TOP_SYMBOL_LIMIT,
  isOpenAssetsPolicy,
  parseAllowedAssets,
  parseWatchlist,
  resolveScanAssets,
} from "./allowedAssets";

/**
 * Server-only scan resolver. Forex pulls EXCLUSIVELY from the user's live broker
 * universe (EA Market Watch) via listBrokerSymbols — there is no static fallback
 * list. When the policy is open we enumerate the broker's tradable forex
 * symbols; when the broker is not linked or no symbols have arrived, we return
 * [] so the caller surfaces an explicit "connect your broker" state instead of
 * inventing pairs.
 *
 * Lives in a `.server` module because eaStore imports Node-only modules
 * (pg/sqlite/ioredis) that must never leak into a client bundle.
 */
export async function resolveScanAssetsForMarket(
  raw: string,
  market: MarketType,
  userId: number,
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
      // Owner decision: market-data universe from OANDA when configured.
      if (oandaConfigured()) {
        try {
          const oanda = await fetchOandaInstruments();
          const fx = oanda
            .filter((i) => i.type === "CURRENCY" || i.type === "METAL")
            .map((i) => i.symbol);
          if (fx.length > 0) return fx.slice(0, topLimit);
        } catch {
          /* fall through to EA universe */
        }
      }
      const broker = await listBrokerSymbols(userId, { forexOnly: true });
      return broker.slice(0, topLimit);
    }
    return parseAllowedAssets(raw, "forex").slice(0, topLimit);
  }
  return resolveScanAssets(raw, topLimit);
}
