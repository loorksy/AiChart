import { getAccountSummary } from "@/lib/binance";
import { searchBinanceInstruments } from "@/lib/binanceSymbols";
import { botsLiveEnabled } from "@/lib/botExecution";
import { resolveForexBackendForUser } from "@/lib/store";
import {
  binanceEnvToExecution,
  executionEnvLabelAr,
  mtModeToExecution,
  normalizeMtTradeMode,
  type ExecutionEnv,
} from "@/lib/executionEnv";
import {
  getEaConnection,
  getEaConnectionMeta,
  isHeartbeatFresh,
  parseEaSymbolSpecs,
} from "@/lib/eaStore";
import { isForexSymbol } from "@/lib/eaLiveState";
import { getMtConnectionStatus } from "@/lib/mtConnectFlow";
import { getRpcConnection } from "@/lib/metaapi/client";
import { spreadFromBidAsk } from "@/lib/spread";
import {
  getBinanceAccountMeta,
  getBinanceCredentials,
  getMtAccount,
} from "@/lib/store";

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
    accountEnv: ExecutionEnv | null;
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
    accountEnv: ExecutionEnv | null;
    accountEnvLabel: string;
    balance: number | null;
    equity: number | null;
    currency: string | null;
  };
  symbols: BotBrokerSymbol[];
}

const BACKEND_LABEL: Record<"ea" | "metaapi" | "mt5local", string> = {
  ea: "جسر EA",
  metaapi: "MetaApi",
  mt5local: "MT5 محلي",
};

function formatTickLabel(spreadPips: number | null, spreadPct: number | null): string | null {
  if (spreadPips != null && spreadPips > 0 && spreadPips < 10_000) {
    return `${spreadPips} pips`;
  }
  if (spreadPct != null && spreadPct > 0) {
    return `${spreadPct}%`;
  }
  return null;
}

async function loadForexSymbols(
  userId: number,
  backend: "ea" | "metaapi" | "mt5local",
): Promise<BotBrokerSymbol[]> {
  const rows: BotBrokerSymbol[] = [];
  const seen = new Set<string>();

  const push = (row: BotBrokerSymbol) => {
    const key = row.symbol.toUpperCase();
    if (seen.has(key)) return;
    seen.add(key);
    rows.push(row);
  };

  if (backend === "ea") {
    const conn = await getEaConnection(userId);
    if (!conn) return rows;
    for (const spec of parseEaSymbolSpecs(conn.symbol_specs_json)) {
      const symbol = (spec.symbol || "").toUpperCase();
      if (!symbol) continue;
      const market = isForexSymbol(symbol) ? "forex" : "crypto";
      if (market !== "forex") continue;
      const bid = Number(spec.bid) || 0;
      const ask = Number(spec.ask) || 0;
      const sp = bid > 0 && ask > 0 ? spreadFromBidAsk(bid, ask, symbol) : null;
      const spreadPips = sp ? Math.round(sp.spreadPips * 10) / 10 : null;
      const spreadPct = sp ? Math.round(sp.spreadPct * 1000) / 1000 : null;
      push({
        symbol,
        market: "forex",
        spreadPips,
        spreadPct,
        tradable: bid > 0 && ask > 0,
        tickLabel: formatTickLabel(spreadPips, spreadPct),
      });
    }
    rows.sort((a, b) => a.symbol.localeCompare(b.symbol));
    return rows;
  }

  const row = await getMtAccount(userId);
  if (row?.metaapi_account_id && row.metaapi_account_id !== "mt5local") {
    try {
      const conn = await getRpcConnection(userId, row.metaapi_account_id);
      const symbols = await conn.getSymbols();
      for (const sym of symbols) {
        const symbol = sym.toUpperCase();
        if (!isForexSymbol(symbol)) continue;
        push({
          symbol,
          market: "forex",
          spreadPips: null,
          spreadPct: null,
          tradable: true,
          tickLabel: null,
        });
      }
    } catch {
      /* fall through */
    }
  }

  if (rows.length === 0 && backend === "mt5local") {
    const conn = await getEaConnection(userId);
    if (conn) {
      for (const spec of parseEaSymbolSpecs(conn.symbol_specs_json)) {
        const symbol = (spec.symbol || "").toUpperCase();
        if (!symbol || !isForexSymbol(symbol)) continue;
        push({
          symbol,
          market: "forex",
          spreadPips: null,
          spreadPct: null,
          tradable: true,
          tickLabel: null,
        });
      }
    }
  }

  rows.sort((a, b) => a.symbol.localeCompare(b.symbol));
  return rows;
}

async function loadCryptoSymbols(): Promise<BotBrokerSymbol[]> {
  const { instruments } = await searchBinanceInstruments("", 300);
  return instruments.map((i) => ({
    symbol: i.symbol,
    market: "crypto" as const,
    spreadPips: null,
    spreadPct: null,
    tradable: true,
    tickLabel: null,
  }));
}

async function loadBrokerSymbols(
  userId: number,
  market: "forex" | "crypto",
): Promise<BotBrokerSymbol[]> {
  if (market === "crypto") return loadCryptoSymbols();
  const backend = await resolveForexBackendForUser(userId);
  return loadForexSymbols(userId, backend);
}

function usdtBalance(balances: Array<{ asset: string; free: string; locked: string }>): number | null {
  const usdt = balances.find((b) => b.asset === "USDT");
  if (!usdt) return null;
  const total = parseFloat(usdt.free) + parseFloat(usdt.locked);
  return Number.isFinite(total) ? total : null;
}

/** Aggregated broker connection, account env, balance, and symbol list for the bots UI. */
export async function loadBotsMeta(
  userId: number,
  market: "forex" | "crypto" = "forex",
): Promise<BotsMetaResponse> {
  const [forexStatus, binanceMeta, symbols] = await Promise.all([
    getMtConnectionStatus(userId),
    getBinanceAccountMeta(userId),
    loadBrokerSymbols(userId, market),
  ]);

  let forexAccountEnv: ExecutionEnv | null = null;
  if (forexStatus.backend === "ea" && forexStatus.connected) {
    const eaMeta = await getEaConnectionMeta(userId);
    forexAccountEnv = mtModeToExecution(
      normalizeMtTradeMode(eaMeta?.account_trade_mode ?? null),
    );
  } else if (
    (forexStatus.backend === "metaapi" || forexStatus.backend === "mt5local") &&
    forexStatus.connected
  ) {
    const conn = await getEaConnection(userId);
    if (conn && isHeartbeatFresh(conn.last_heartbeat_at)) {
      forexAccountEnv = mtModeToExecution(
        normalizeMtTradeMode(conn.account_trade_mode ?? null),
      );
    }
  }

  const forexBackend = forexStatus.backend;
  const forexConnected = Boolean(forexStatus.connected);
  const forexOnline = Boolean(forexStatus.online);

  let binanceConnected = Boolean(binanceMeta);
  let binanceOnline = false;
  let binanceEnv: "testnet" | "prod" | null = binanceMeta?.env ?? null;
  let binanceBalance: number | null = null;
  let binanceEquity: number | null = null;

  if (binanceMeta) {
    const creds = await getBinanceCredentials(userId);
    if (creds) {
      try {
        const summary = await getAccountSummary(
          creds.apiKey,
          creds.apiSecret,
          creds.env,
          creds.region,
        );
        binanceOnline = Boolean(summary.canTrade);
        binanceEnv = creds.env;
        binanceBalance = usdtBalance(summary.balances);
        binanceEquity = binanceBalance;
      } catch {
        binanceOnline = false;
      }
    }
  }

  const fs = forexStatus as Record<string, unknown>;

  return {
    at: new Date().toISOString(),
    liveEnabled: botsLiveEnabled(),
    forex: {
      backend: forexBackend,
      backendLabel: BACKEND_LABEL[forexBackend],
      connected: forexConnected,
      online: forexOnline,
      accountEnv: forexAccountEnv,
      accountEnvLabel: executionEnvLabelAr(forexAccountEnv),
      balance: typeof fs.balance === "number" ? fs.balance : null,
      equity: typeof fs.equity === "number" ? fs.equity : null,
      currency: typeof fs.currency === "string" ? fs.currency : null,
      broker: typeof fs.broker === "string" ? fs.broker : null,
      login: typeof fs.login === "string" ? fs.login : null,
    },
    binance: {
      connected: binanceConnected,
      online: binanceOnline,
      env: binanceEnv,
      accountEnv: binanceEnv ? binanceEnvToExecution(binanceEnv) : null,
      accountEnvLabel: executionEnvLabelAr(
        binanceEnv ? binanceEnvToExecution(binanceEnv) : null,
      ),
      balance: binanceBalance,
      equity: binanceEquity,
      currency: binanceBalance != null ? "USDT" : null,
    },
    symbols,
  };
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
