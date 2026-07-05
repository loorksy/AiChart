/** Forex market-data source (candles, instruments, live price). Execution stays on FOREX_BACKEND. */
export type ForexDataSourceMode = "oanda" | "ea";

export function getForexDataSourceMode(): ForexDataSourceMode {
  const forced = process.env.FOREX_DATA_SOURCE?.trim().toLowerCase();
  if (forced === "ea") return "ea";
  return "oanda";
}

/** When true, OHLC/instruments ignore EA bridge — OANDA only. */
export function isOandaDataOnly(): boolean {
  return getForexDataSourceMode() === "oanda";
}
