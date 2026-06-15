/** In-memory live quote cache pushed by EA v3 (single VPS process). */

export interface EaLiveQuote {
  symbol: string;
  bid: number;
  ask: number;
  tickTime?: number;
  updatedAt: number;
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
