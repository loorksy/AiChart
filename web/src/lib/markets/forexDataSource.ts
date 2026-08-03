/** Forex market-data source (candles, instruments, live price). Execution stays on FOREX_BACKEND. */
export type ForexDataSourceMode = "oanda" | "metaapi";

export function getForexDataSourceMode(): ForexDataSourceMode {
  const forced = process.env.FOREX_DATA_SOURCE?.trim().toLowerCase();
  if (forced === "metaapi") return "metaapi";
  return "oanda";
}

/** When true, OHLC/instruments default to OANDA even with a cloud account linked. */
export function isOandaDataOnly(): boolean {
  return getForexDataSourceMode() === "oanda";
}
