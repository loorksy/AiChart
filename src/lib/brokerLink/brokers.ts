/**
 * MetaAPI's hosted page collects login and password only. Creating the DRAFT
 * still requires platform + server from our API — those are hardcoded here so
 * Lonora never shows a broker/server/login/password form.
 */
export const BROKER_PLATFORM = "mt5" as const;

export interface BrokerOption {
  id: string;
  name: string;
  server: string;
  keywords?: string[];
}

/** Silent default for DRAFT create. Users never pick this in the UI. */
export const DEFAULT_BROKER: BrokerOption = {
  id: "icmarkets-mt5",
  name: "IC Markets",
  server: "ICMarketsSC-MT5",
  keywords: ["Raw Trading Ltd"],
};
