export interface BotBrokerSymbol {
  symbol: string;
  market: "forex" | "crypto";
  spreadPips: number | null;
  spreadPct: number | null;
  tradable: boolean;
  /** Short label for dropdown, e.g. "1.2 pips" or "0.04%" */
  tickLabel: string | null;
}

export interface BotsMetaResponse {
  at: string;
  liveEnabled: boolean;
  forex: {
    backend: "ea" | "metaapi" | "mt5local";
    backendLabel: string;
    connected: boolean;
    online: boolean;
    accountEnv: "demo" | "live" | null;
    accountEnvLabel: string;
    balance: number | null;
    equity: number | null;
    currency: string | null;
    broker: string | null;
    login: string | null;
  };
  binance: {
    connected: boolean;
    online: boolean;
    env: "testnet" | "prod" | null;
    accountEnv: "demo" | "live" | null;
    accountEnvLabel: string;
    balance: number | null;
    equity: number | null;
    currency: string | null;
  };
  symbols: BotBrokerSymbol[];
}

/** Preferred default symbol when market or symbol list changes. */
export function pickDefaultSymbol(
  market: "forex" | "crypto",
  symbols: BotBrokerSymbol[],
): string {
  const prefs =
    market === "forex"
      ? ["XAUUSD", "EURUSD", "GBPUSD", "USDJPY"]
      : ["BTCUSDT", "ETHUSDT", "BNBUSDT"];
  const tradable = symbols.filter((s) => s.tradable !== false);
  const pool = tradable.length > 0 ? tradable : symbols;
  for (const pref of prefs) {
    const hit = pool.find((s) => s.symbol.toUpperCase() === pref);
    if (hit) return hit.symbol;
  }
  return pool[0]?.symbol ?? (market === "forex" ? "EURUSD" : "BTCUSDT");
}
