import type { MarketType } from "./markets/types";
import { DATA_SYMBOL } from "./gold";
import { MONITOR_TOP_SYMBOL_LIMIT, resolveScanAssets } from "./allowedAssets";

/**
 * Server-side scan universe.
 *
 * There is one instrument, so there is one answer. The watchlist/allow-list/
 * broker-catalogue machinery this used to consult is gone with the multi-pair
 * universe: no stored preference can widen a universe of one.
 */
export async function resolveScanAssetsForMarket(
  raw: string,
  market: MarketType,
  _userId: number,
  topLimit = MONITOR_TOP_SYMBOL_LIMIT,
): Promise<string[]> {
  if (market === "forex") return [DATA_SYMBOL];
  return resolveScanAssets(raw, topLimit);
}
