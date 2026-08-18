/**
 * Tap-to-pick broker catalogue for the hosted MetaAPI credentials flow.
 *
 * Lonora never asks for a free-text server name. Each entry is an MT5 server
 * MetaAPI can auto-detect; the hosted page then collects login/password.
 * Platform is hardcoded MT5 — there is no MT4 option.
 */
export const BROKER_PLATFORM = "mt5" as const;

export type BrokerEnv = "live" | "demo";

export interface BrokerOption {
  id: string;
  name: string;
  server: string;
  env: BrokerEnv;
  /** Helps MetaAPI resolve the .dat when the server name is ambiguous. */
  keywords?: string[];
}

export const BROKER_CATALOG: readonly BrokerOption[] = [
  {
    id: "icmarkets-mt5",
    name: "IC Markets",
    server: "ICMarketsSC-MT5",
    env: "live",
    keywords: ["Raw Trading Ltd"],
  },
  {
    id: "icmarkets-mt5-demo",
    name: "IC Markets Demo",
    server: "ICMarketsSC-Demo",
    env: "demo",
    keywords: ["Raw Trading Ltd"],
  },
  {
    id: "pepperstone-mt5",
    name: "Pepperstone",
    server: "Pepperstone-MT5-Live01",
    env: "live",
    keywords: ["Pepperstone Group Limited"],
  },
  {
    id: "exness-mt5",
    name: "Exness",
    server: "Exness-MT5Real",
    env: "live",
    keywords: ["Exness"],
  },
  {
    id: "exness-mt5-demo",
    name: "Exness Demo",
    server: "Exness-MT5Trial",
    env: "demo",
    keywords: ["Exness"],
  },
  {
    id: "fusion-mt5",
    name: "Fusion Markets",
    server: "FusionMarkets-Live",
    env: "live",
    keywords: ["Fusion Markets"],
  },
] as const;

export function brokerById(id: string): BrokerOption | undefined {
  return BROKER_CATALOG.find((b) => b.id === id);
}

export function publicBroker(b: BrokerOption): {
  id: string;
  name: string;
  env: BrokerEnv;
} {
  return { id: b.id, name: b.name, env: b.env };
}
