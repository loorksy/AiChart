import { getAccountSummary } from "@/lib/binance";
import { searchBinanceInstruments } from "@/lib/binanceSymbols";
import { botsLiveEnabled } from "@/lib/botExecution";
import { getBinanceAccountMeta, getBinanceCredentials, getMtAccount } from "@/lib/store";
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
import {
  forexBaseQuote,
  searchForexInstruments,
} from "@/lib/markets/forexInstruments";
import { spreadFromBidAsk } from "@/lib/spread";
import type {
  BotBrokerSymbol,
  BotsMetaEaBridge,
  BotsMetaResponse,
} from "@/lib/botsMetaTypes";
import type { EaConnectionMeta, EaSymbolSpec } from "@/lib/types";

const TICKER_24H_URL = "https://data-api.binance.vision/api/v3/ticker/24hr";
const DEFAULT_SYMBOL_LIMIT = 500;

const BACKEND_LABEL: Record<"ea" | "metaapi" | "mt5local", string> = {
  ea: "جسر EA",
  metaapi: "MetaApi",
  mt5local: "MT5 محلي",
};

/** EA bridge sidecar when bot execution backend ≠ EA but EA token exists. */
export function buildEaBridgeSidecar(
  executionBackend: "ea" | "metaapi" | "mt5local",
  eaMeta: EaConnectionMeta | null,
): { eaBridge: BotsMetaEaBridge | null; channelNote: string | null } {
  if (!eaMeta || eaMeta.status === "revoked" || executionBackend === "ea") {
    return { eaBridge: null, channelNote: null };
  }

  const eaBridge: BotsMetaEaBridge = {
    connected: true,
    online: eaMeta.online,
    broker: eaMeta.broker_name,
    login: eaMeta.account_login,
    platform: eaMeta.platform,
  };

  const channelNote = eaMeta.online
    ? `البوت يستخدم ${BACKEND_LABEL[executionBackend]} — غيّر الطريقة إلى EA للتنفيذ عبر الجسر`
    : null;

  return { eaBridge, channelNote };
}

function formatTickLabel(spreadPips: number | null, spreadPct: number | null): string | null {
  if (spreadPips != null && spreadPips > 0 && spreadPips < 10_000) {
    return `${spreadPips} pips`;
  }
  if (spreadPct != null && spreadPct > 0) {
    return `${spreadPct}%`;
  }
  return null;
}

function symbolScore(row: BotBrokerSymbol): number {
  return (
    (row.price ? 4 : 0) +
    (row.spreadPips != null ? 2 : 0) +
    (row.tradable ? 1 : 0)
  );
}

function forexRowFromSpec(spec: EaSymbolSpec): BotBrokerSymbol | null {
  const raw = (spec.symbol || "").trim();
  if (!raw || !isForexSymbol(raw)) return null;
  const bid = Number(spec.bid) || 0;
  const ask = Number(spec.ask) || 0;
  const sp = bid > 0 && ask > 0 ? spreadFromBidAsk(bid, ask, raw) : null;
  const spreadPips = sp ? Math.round(sp.spreadPips * 10) / 10 : null;
  const spreadPct = sp ? Math.round(sp.spreadPct * 1000) / 1000 : null;
  const price = bid > 0 && ask > 0 ? (bid + ask) / 2 : bid || ask || null;
  const { base, quote } = forexBaseQuote(raw);
  return {
    symbol: raw,
    market: "forex",
    spreadPips,
    spreadPct,
    tradable: bid > 0 && ask > 0,
    tickLabel: formatTickLabel(spreadPips, spreadPct),
    price,
    changePct: null,
    base,
    quote,
  };
}

function mergeSymbolRow(
  map: Map<string, BotBrokerSymbol>,
  row: BotBrokerSymbol,
): void {
  const key = row.symbol.toUpperCase();
  const existing = map.get(key);
  if (!existing) {
    map.set(key, row);
    return;
  }
  if (symbolScore(row) >= symbolScore(existing)) {
    map.set(key, { ...existing, ...row, symbol: row.symbol });
  }
}

async function mergeMetaApiForexSymbols(
  userId: number,
  map: Map<string, BotBrokerSymbol>,
): Promise<void> {
  const row = await getMtAccount(userId);
  if (!row?.metaapi_account_id || row.metaapi_account_id === "mt5local") return;
  try {
    const conn = await getRpcConnection(userId, row.metaapi_account_id);
    const symbols = await conn.getSymbols();
    for (const sym of symbols) {
      const raw = sym.trim();
      if (!raw || !isForexSymbol(raw)) continue;
      const { base, quote } = forexBaseQuote(raw);
      mergeSymbolRow(map, {
        symbol: raw,
        market: "forex",
        spreadPips: null,
        spreadPct: null,
        tradable: true,
        tickLabel: null,
        price: null,
        changePct: null,
        base,
        quote,
      });
    }
  } catch {
    /* fall through */
  }
}

/**
 * Forex symbols for bots UI: MetaApi full broker list + EA heartbeat quotes +
 * static baseline. EA heartbeat alone only covers Market Watch (~few pairs).
 */
async function loadForexSymbols(userId: number): Promise<BotBrokerSymbol[]> {
  const map = new Map<string, BotBrokerSymbol>();

  for (const inst of searchForexInstruments("")) {
    mergeSymbolRow(map, {
      symbol: inst.symbol,
      market: "forex",
      spreadPips: null,
      spreadPct: null,
      tradable: true,
      tickLabel: null,
      price: null,
      changePct: null,
      base: inst.base,
      quote: inst.quote,
    });
  }

  await mergeMetaApiForexSymbols(userId, map);

  const conn = await getEaConnection(userId);
  if (conn) {
    for (const spec of parseEaSymbolSpecs(conn.symbol_specs_json)) {
      const row = forexRowFromSpec(spec);
      if (row) mergeSymbolRow(map, row);
    }
  }

  return Array.from(map.values()).sort((a, b) =>
    a.symbol.localeCompare(b.symbol),
  );
}

async function enrichCryptoWithTickers(
  rows: BotBrokerSymbol[],
): Promise<BotBrokerSymbol[]> {
  if (rows.length === 0) return rows;
  try {
    const res = await fetch(TICKER_24H_URL, { next: { revalidate: 60 } });
    if (!res.ok) return rows;
    const tickers = (await res.json()) as Array<{
      symbol: string;
      lastPrice: string;
      priceChangePercent: string;
    }>;
    const wanted = new Set(rows.map((r) => r.symbol.toUpperCase()));
    const bySym = new Map<string, { price: number; changePct: number }>();
    for (const t of tickers) {
      if (!wanted.has(t.symbol)) continue;
      bySym.set(t.symbol, {
        price: Number(t.lastPrice),
        changePct: Number(t.priceChangePercent),
      });
    }
    return rows.map((row) => {
      const tick = bySym.get(row.symbol.toUpperCase());
      if (!tick) return row;
      return {
        ...row,
        price: tick.price,
        changePct: tick.changePct,
      };
    });
  } catch {
    return rows;
  }
}

function filterSymbolRows(
  rows: BotBrokerSymbol[],
  q: string,
  limit: number,
): BotBrokerSymbol[] {
  const query = q.trim().toUpperCase();
  let filtered = rows;
  if (query) {
    filtered = rows.filter(
      (r) =>
        r.symbol.toUpperCase().includes(query) ||
        (r.base ?? "").toUpperCase().includes(query),
    );
  }
  return filtered.slice(0, limit);
}

/** @internal exported for unit tests */
export function mergeBotSymbolRow(
  map: Map<string, BotBrokerSymbol>,
  row: BotBrokerSymbol,
): void {
  mergeSymbolRow(map, row);
}

/** @internal exported for unit tests */
export { forexRowFromSpec };

async function loadBrokerSymbols(
  userId: number,
  market: "forex" | "crypto",
): Promise<BotBrokerSymbol[]> {
  const { symbols } = await searchBotSymbols(userId, market, "", 120);
  return symbols;
}

/** Searchable symbol list with live quotes for the bots symbol picker. */
export async function searchBotSymbols(
  userId: number,
  market: "forex" | "crypto",
  q = "",
  limit = DEFAULT_SYMBOL_LIMIT,
): Promise<{ symbols: BotBrokerSymbol[]; total: number }> {
  const capped = Math.min(Math.max(limit, 1), DEFAULT_SYMBOL_LIMIT);
  if (market === "crypto") {
    const { instruments, total } = await searchBinanceInstruments(q, capped);
    const rows = instruments.map((i) => ({
      symbol: i.symbol,
      market: "crypto" as const,
      spreadPips: null,
      spreadPct: null,
      tradable: true,
      tickLabel: null,
      price: null,
      changePct: null,
      base: i.base,
      quote: i.quote,
    }));
    const enriched = await enrichCryptoWithTickers(rows);
    return { symbols: enriched, total };
  }

  const all = await loadForexSymbols(userId);
  const filtered = filterSymbolRows(all, q, capped);
  return { symbols: filtered, total: all.length };
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
  const [forexStatus, eaMeta, binanceMeta, symbols] = await Promise.all([
    getMtConnectionStatus(userId),
    getEaConnectionMeta(userId),
    getBinanceAccountMeta(userId),
    loadBrokerSymbols(userId, market),
  ]);

  const { eaBridge, channelNote } = buildEaBridgeSidecar(
    forexStatus.backend,
    eaMeta,
  );

  let forexAccountEnv: ExecutionEnv | null = null;
  if (forexStatus.backend === "ea" && forexStatus.connected && eaMeta) {
    forexAccountEnv = mtModeToExecution(
      normalizeMtTradeMode(eaMeta.account_trade_mode ?? null),
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
      eaBridge,
      channelNote,
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
