/**
 * Retired: MetaApi tick streaming was the platform's live market-data path
 * before the OANDA migration (see markets/oandaStream.ts, which replaced it
 * for chart/analysis ticks). MetaApi's streaming connection is execution
 * infrastructure now, not a data source — nothing calls
 * `subscribeToMarketData`/quote listeners here anymore.
 *
 * `clearStreamingCache` stays as a no-op stub because `metaapi/client.ts`'s
 * `clearRpcCache` still calls it on every account unlink/re-link; there is
 * nothing left to clear, but keeping the call site working avoids touching
 * the execution-adjacent lifecycle code for a data-path retirement.
 */
export function clearStreamingCache(_userId?: number): void {
  /* no-op — no live stream state remains to clear */
}
