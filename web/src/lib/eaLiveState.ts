import {
  getEaConnection,
  parseEaSymbolSpecs,
} from "./eaStore";
import {
  getStaleQuoteThresholdMs,
  isQuoteFresh,
  type FreshnessSource,
} from "./bridge/freshness";
import { spreadFromBidAsk } from "./spread";

/** In-memory live quote cache pushed by EA v3 (single VPS process). */

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
  isFresh: boolean;
  source: FreshnessSource;
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

export function updateEaLiveQuotes(
  userId: number,
  quotes: Array<{
    symbol: string;
    bid: number;
    ask: number;
    tick_time?: number;
  }>,
): void {
  let map = quotesByUser.get(userId);
  if (!map) {
    map = new Map();
    quotesByUser.set(userId, map);
  }
  const now = Date.now();
  for (const q of quotes) {
    const sym = q.symbol?.trim();
    if (!sym) continue;
    map.set(sym.toUpperCase(), {
      symbol: sym,
      bid: Number(q.bid) || 0,
      ask: Number(q.ask) || 0,
      tickTime: q.tick_time,
      updatedAt: now,
    });
  }
}

export function getEaLiveQuote(
  userId: number,
  symbol: string,
): (EaLiveQuote & { quoteAgeMs: number }) | null {
  const map = quotesByUser.get(userId);
  if (!map) return null;
  const q = map.get(symbol.toUpperCase());
  if (!q) return null;
  return { ...q, quoteAgeMs: Date.now() - q.updatedAt };
}

export function getEaLiveQuotes(
  userId: number,
): Record<string, EaLiveQuote & { quoteAgeMs: number }> {
  const map = quotesByUser.get(userId);
  const out: Record<string, EaLiveQuote & { quoteAgeMs: number }> = {};
  if (!map) return out;
  const now = Date.now();
  for (const [key, q] of map) {
    out[key] = { ...q, quoteAgeMs: now - q.updatedAt };
  }
  return out;
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
  return {
    ...quote,
    spreadPips: spread ? Math.round(spread.spreadPips * 10) / 10 : null,
    isFresh: isQuoteFresh(quote.quoteAgeMs, thresholdMs),
    source,
  };
}

/** Live quotes with freshness metadata — fresh symbols sorted first. */
export async function buildEaLiveQuotesSummary(
  userId: number,
): Promise<EaLiveQuotesSummary> {
  const thresholdMs = getStaleQuoteThresholdMs();
  const liveMap = getEaLiveQuotes(userId);
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
export function resolveLiveForexMid(
  userId: number,
  symbol: string,
  fallbackBid?: number,
  fallbackAsk?: number,
): { price: number; quoteAgeMs: number; source: "live" | "heartbeat" } {
  const live = getEaLiveQuote(userId, symbol);
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
