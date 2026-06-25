export interface BotBrokerSymbol {
  symbol: string;
  market: "forex" | "crypto";
  spreadPips: number | null;
  spreadPct: number | null;
  tradable: boolean;
  /** Short label for dropdown, e.g. "1.2 pips" or "0.04%" */
  tickLabel: string | null;
  /** Mid or last price when available (EA bid/ask or Binance ticker). */
  price?: number | null;
  /** 24h change % (crypto); null for forex when unavailable. */
  changePct?: number | null;
  base?: string;
  quote?: string;
}

/** EA bridge status when registered separately from the bot execution backend. */
export interface BotsMetaEaBridge {
  connected: boolean;
  online: boolean;
  broker: string | null;
  login: string | null;
  platform: string | null;
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
    /** Present when EA is registered but bot executes via another backend. */
    eaBridge: BotsMetaEaBridge | null;
    /** Arabic hint when execution backend differs from a live EA bridge. */
    channelNote: string | null;
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
