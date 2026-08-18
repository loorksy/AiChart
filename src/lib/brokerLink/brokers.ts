/**
 * Tap-to-pick MT5 catalogue. MetaAPI's hosted page only collects login and
 * password — platform + server must be chosen before we create the DRAFT.
 * There is no MT4 option.
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
  {
    id: "xm-mt5",
    name: "XM",
    server: "XMGlobal-MT5",
    env: "live",
    keywords: ["XM Global Limited"],
  },
  {
    id: "fbs-mt5",
    name: "FBS",
    server: "FBS-Real",
    env: "live",
    keywords: ["FBS"],
  },
  {
    id: "vantage-mt5",
    name: "Vantage",
    server: "VantageInternational-MT5",
    env: "live",
    keywords: ["Vantage"],
  },
  {
    id: "fpmarkets-mt5",
    name: "FP Markets",
    server: "FPMarkets-Live",
    env: "live",
    keywords: ["First Prudential Markets"],
  },
] as const;

const SERVER_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{1,78}$/;

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

/** Custom MT5 server from the user's terminal — still no login/password. */
export function brokerFromServer(server: string): BrokerOption | null {
  const trimmed = server.trim();
  if (!SERVER_RE.test(trimmed)) return null;
  return {
    id: `custom:${trimmed.toLowerCase()}`,
    name: trimmed,
    server: trimmed,
    env: "live",
  };
}
