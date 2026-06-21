import {
  getEaConnection,
  parseEaSymbolSpecs,
} from "./eaStore";
import {
  getStaleQuoteThresholdMs,
  isQuoteFresh,
  type FreshnessSource,
} from "./bridge/freshness";
import { bridgeRedisKey, getBridgeKvStore } from "./bridge/store";
import { spreadFromBidAsk } from "./spread";
import { recordEaQuoteTickGap } from "./eaQuoteMetrics";

/** Live quote cache pushed by EA v3 — memory L1, Redis L2 when REDIS_URL is set. */

export interface EaLiveQuote {
  symbol: string;
  bid: number;
  ask: number;
  tickTime?: number;
  updatedAt: number;
}

export interface EnrichedEaLiveQuote extends EaLiveQuote {
  quoteAgeMs: number;
  spreadPips: number | null;
  /** Raw spread in price units (e.g. 15.0 USD for BCHUSDm). */
  spreadPrice: number | null;
  /** Spread as % of mid — reliable for all instruments. */
  spreadPct: number | null;
  isFresh: boolean;
  source: FreshnessSource;
  /** Age of last MT5 tick in ms (undefined when tickTime not provided by EA). */
  tickAgeMs?: number;
  /**
   * True when tickAgeMs exceeds the per-market threshold.
   * Forex pairs: stale after FOREX_TICK_STALE_MS (default 120 s).
   * Crypto CFDs (symbol ends in 'M' like BTCUSDm): 24/7 market, not flagged.
   */
  tickStale?: boolean;
}

export interface EaLiveQuotesSummary {
  quotes: EnrichedEaLiveQuote[];
  freshCount: number;
  staleCount: number;
  freshSymbols: string[];
  staleThresholdMs: number;
  count: number;
}

export interface EaLiveEvent {
  type: string;
  symbol?: string;
  dealId?: number;
  at: number;
  payload: Record<string, unknown>;
}

const quotesByUser = new Map<number, Map<string, EaLiveQuote>>();
const eventsByUser = new Map<number, EaLiveEvent[]>();
const MAX_EVENTS = 50;
const EA_QUOTES_REDIS_TTL_MS = 120_000;

function quotesRedisKey(userId: number): string {
  return bridgeRedisKey("cache", ["ea-quotes", String(userId)]);
}

function getOrCreateUserMap(userId: number): Map<string, EaLiveQuote> {
  let map = quotesByUser.get(userId);
  if (!map) {
    map = new Map();
    quotesByUser.set(userId, map);
  }
  return map;
}

function serializeUserQuotes(map: Map<string, EaLiveQuote>): string {
  const out: Record<string, EaLiveQuote> = {};
  for (const [key, q] of map) {
    out[key] = q;
  }
  return JSON.stringify(out);
}

function parseStoredQuotes(raw: string): Map<string, EaLiveQuote> | null {
  try {
    const parsed = JSON.parse(raw) as Record<string, EaLiveQuote>;
    if (!parsed || typeof parsed !== "object") return null;
    const map = new Map<string, EaLiveQuote>();
    for (const [key, q] of Object.entries(parsed)) {
      if (!q || typeof q !== "object") continue;
      map.set(key.toUpperCase(), {
        symbol: String(q.symbol ?? key),
        bid: Number(q.bid) || 0,
        ask: Number(q.ask) || 0,
        tickTime: q.tickTime,
        updatedAt: Number(q.updatedAt) || Date.now(),
      });
    }
    return map;
  } catch {
    return null;
  }
}

async function persistQuotesToRedis(
  userId: number,
  map: Map<string, EaLiveQuote>,
): Promise<void> {
  if (map.size === 0) return;
  const store = getBridgeKvStore();
  await store.set(
    quotesRedisKey(userId),
    serializeUserQuotes(map),
    EA_QUOTES_REDIS_TTL_MS,
  );
}

async function hydrateQuotesFromRedis(userId: number): Promise<void> {
  const local = quotesByUser.get(userId);
  if (local && local.size > 0) return;

  const store = getBridgeKvStore();
  const raw = await store.get(quotesRedisKey(userId));
  if (!raw) return;

  const parsed = parseStoredQuotes(raw);
  if (!parsed || parsed.size === 0) return;

  const map = getOrCreateUserMap(userId);
  for (const [key, q] of parsed) {
    if (!map.has(key)) {
      map.set(key, q);
    }
  }
}

export async function updateEaLiveQuotes(
  userId: number,
  quotes: Array<{
    symbol: string;
    bid: number;
    ask: number;
    tick_time?: number;
  }>,
): Promise<void> {
  const map = getOrCreateUserMap(userId);
  const now = Date.now();
  for (const q of quotes) {
    const sym = q.symbol?.trim();
    if (!sym) continue;
    const key = sym.toUpperCase();
    const prev = map.get(key);
    recordEaQuoteTickGap(userId, sym, prev?.updatedAt, now);
    map.set(key, {
      symbol: sym,
      bid: Number(q.bid) || 0,
      ask: Number(q.ask) || 0,
      tickTime: q.tick_time,
      updatedAt: now,
    });
  }
  await persistQuotesToRedis(userId, map);
}

export async function getEaLiveQuote(
  userId: number,
  symbol: string,
): Promise<(EaLiveQuote & { quoteAgeMs: number }) | null> {
  await hydrateQuotesFromRedis(userId);
  const map = quotesByUser.get(userId);
  if (!map) return null;
  const q = map.get(symbol.toUpperCase());
  if (!q) return null;
  return { ...q, quoteAgeMs: Date.now() - q.updatedAt };
}

export async function getEaLiveQuotes(
  userId: number,
): Promise<Record<string, EaLiveQuote & { quoteAgeMs: number }>> {
  await hydrateQuotesFromRedis(userId);
  const map = quotesByUser.get(userId);
  const out: Record<string, EaLiveQuote & { quoteAgeMs: number }> = {};
  if (!map) return out;
  const now = Date.now();
  for (const [key, q] of map) {
    out[key] = { ...q, quoteAgeMs: now - q.updatedAt };
  }
  return out;
}

/** Test helper — clears in-memory quotes for a user. */
export function clearEaLiveQuotesForTests(userId?: number): void {
  if (userId === undefined) {
    quotesByUser.clear();
    return;
  }
  quotesByUser.delete(userId);
}

export function pushEaEvent(
  userId: number,
  event: Omit<EaLiveEvent, "at"> & { at?: number },
): void {
  const list = eventsByUser.get(userId) ?? [];
  list.unshift({
    ...event,
    at: event.at ?? Date.now(),
  });
  if (list.length > MAX_EVENTS) list.length = MAX_EVENTS;
  eventsByUser.set(userId, list);
}

export function getEaRecentEvents(userId: number, limit = 10): EaLiveEvent[] {
  return (eventsByUser.get(userId) ?? []).slice(0, limit);
}

/**
 * Default threshold for forex tick staleness: 120 s (2 min between ticks on an
 * open market is already suspicious). Configurable via FOREX_TICK_STALE_MS.
 */
function getForexTickStaleMs(): number {
  const raw = Number(process.env.FOREX_TICK_STALE_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 120_000;
}

/**
 * True for instruments that trade on a weekday session schedule (forex majors,
 * metals, indices). Crypto CFDs (XBTUSDm, BTCUSDm, ETHUSDm…) trade 24/7 on
 * Exness and should NOT be penalised for quiet weekends.
 * Heuristic: if the root symbol starts with well-known crypto tickers or the
 * symbol matches common crypto CFD patterns, it's 24/7.
 */
export function isForexSymbol(symbol: string): boolean {
  const s = symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
  // Crypto-derived CFDs traded on MT5 brokers — 24/7, no tick staleness gate.
  const cryptoRoots = [
    "BTC", "ETH", "XBT", "LTC", "XRP", "BCH", "ADA", "BNB",
    "SOL", "DOT", "LINK", "UNI", "DOGE", "AVAX", "MATIC", "TRX", "EOS",
  ];
  for (const root of cryptoRoots) {
    if (s.startsWith(root)) return false;
  }
  return true;
}

function heartbeatQuoteAgeMs(lastHeartbeatAt: string | null): number {
  if (!lastHeartbeatAt) return 60_000;
  const iso = lastHeartbeatAt.includes("T")
    ? lastHeartbeatAt
    : `${lastHeartbeatAt.replace(" ", "T")}Z`;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? Date.now() - ms : 60_000;
}

function enrichQuote(
  quote: EaLiveQuote & { quoteAgeMs: number },
  source: FreshnessSource,
  thresholdMs: number,
): EnrichedEaLiveQuote {
  const spread = spreadFromBidAsk(quote.bid, quote.ask, quote.symbol);

  // For crypto CFDs the raw spreadPips number is meaningless (150 000 for BCH).
  // Only expose spreadPips when spreadPipsReliable=true; always expose spreadPrice + spreadPct.
  const spreadPips = spread?.spreadPipsReliable !== false ? (spread ? Math.round(spread.spreadPips * 10) / 10 : null) : null;
  const spreadPrice = spread ? Math.round(spread.spreadRaw * 1e6) / 1e6 : null;
  const spreadPct = spread ? Math.round(spread.spreadPct * 1000) / 1000 : null;

  // Tick-staleness: only applies to forex instruments (not crypto CFDs).
  let tickAgeMs: number | undefined;
  let tickStale: boolean | undefined;
  if (quote.tickTime && quote.tickTime > 0) {
    tickAgeMs = Date.now() - quote.tickTime * 1000;
    if (isForexSymbol(quote.symbol)) {
      tickStale = tickAgeMs > getForexTickStaleMs();
    } else {
      tickStale = false; // crypto CFD — 24/7, never stale by tick age
    }
  }

  return {
    ...quote,
    spreadPips,
    spreadPrice,
    spreadPct,
    isFresh: isQuoteFresh(quote.quoteAgeMs, thresholdMs),
    source,
    ...(tickAgeMs !== undefined ? { tickAgeMs, tickStale } : {}),
  };
}

/** Live quotes with freshness metadata — fresh symbols sorted first. */
export async function buildEaLiveQuotesSummary(
  userId: number,
): Promise<EaLiveQuotesSummary> {
  const thresholdMs = getStaleQuoteThresholdMs();
  const liveMap = await getEaLiveQuotes(userId);
  const conn = await getEaConnection(userId);
  const heartbeatSpecs = parseEaSymbolSpecs(conn?.symbol_specs_json ?? null);
  const hbAgeMs = heartbeatQuoteAgeMs(conn?.last_heartbeat_at ?? null);

  const bySymbol = new Map<string, EnrichedEaLiveQuote>();

  for (const [key, q] of Object.entries(liveMap)) {
    if (q.bid <= 0 || q.ask <= 0) continue;
    const fresh = isQuoteFresh(q.quoteAgeMs, thresholdMs);
    bySymbol.set(key, enrichQuote(q, fresh ? "live" : "stale", thresholdMs));
  }

  for (const spec of heartbeatSpecs) {
    const sym = spec.symbol?.trim().toUpperCase();
    if (!sym || bySymbol.has(sym)) continue;
    const bid = Number(spec.bid) || 0;
    const ask = Number(spec.ask) || 0;
    if (bid <= 0 || ask <= 0) continue;
    const quote: EaLiveQuote & { quoteAgeMs: number } = {
      symbol: spec.symbol,
      bid,
      ask,
      updatedAt: Date.now() - hbAgeMs,
      quoteAgeMs: hbAgeMs,
    };
    bySymbol.set(sym, enrichQuote(quote, "heartbeat", thresholdMs));
  }

  const quotes = [...bySymbol.values()].sort((a, b) => {
    if (a.isFresh !== b.isFresh) return a.isFresh ? -1 : 1;
    return a.symbol.localeCompare(b.symbol);
  });

  const freshSymbols = quotes.filter((q) => q.isFresh).map((q) => q.symbol);
  return {
    quotes,
    freshCount: freshSymbols.length,
    staleCount: quotes.length - freshSymbols.length,
    freshSymbols,
    staleThresholdMs: thresholdMs,
    count: quotes.length,
  };
}

/** Prefer live push; fall back to heartbeat spec bid/ask. */
export async function resolveLiveForexMid(
  userId: number,
  symbol: string,
  fallbackBid?: number,
  fallbackAsk?: number,
): Promise<{ price: number; quoteAgeMs: number; source: "live" | "heartbeat" }> {
  const live = await getEaLiveQuote(userId, symbol);
  if (live && live.bid > 0 && live.ask > 0) {
    return {
      price: (live.bid + live.ask) / 2,
      quoteAgeMs: live.quoteAgeMs,
      source: "live",
    };
  }
  const bid = Number(fallbackBid) || 0;
  const ask = Number(fallbackAsk) || 0;
  const price = bid && ask ? (bid + ask) / 2 : bid || ask || 0;
  return { price, quoteAgeMs: 60_000, source: "heartbeat" };
}
