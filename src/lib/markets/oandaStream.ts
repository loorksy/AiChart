/**
 * OANDA streaming pricing — one shared platform-level connection covering
 * the entire fixed 20-instrument universe (markets/forexInstruments.ts),
 * fanned out to however many SSE listeners are open per symbol.
 *
 * Unlike the retired MetaApi per-user stream, OANDA's v20 streaming endpoint
 * takes its instrument list once at connect time — it has no
 * subscribe/unsubscribe-to-a-symbol call. Because the universe here is fixed
 * and small, one long-lived connection for all 20 symbols is simpler and
 * more robust than reopening a connection per symbol change, and it costs
 * the same one OANDA streaming connection regardless of how many users (or
 * how many symbols) are being watched at once.
 */
import { oandaAccountId, oandaBaseUrl, toOandaInstrument, fromOandaInstrument } from "./oanda";
import { getPlatformValue } from "@/lib/platformConfig";
import { TRADABLE_SYMBOLS } from "./forexInstruments";

export type StreamTick = {
  symbol: string;
  bid: number;
  ask: number;
  mid: number;
  time: number;
};

type TickListener = (tick: StreamTick) => void;

const symbolListeners = new Map<string, Set<TickListener>>();
let active = false;
let stopRequested = false;
let reconnectDelayMs = 1000;
const MAX_RECONNECT_DELAY_MS = 30_000;

function token(): string | undefined {
  return getPlatformValue("OANDA_API_TOKEN") || process.env.OANDA_API_TOKEN || undefined;
}

function streamBaseUrl(): string {
  // Streaming lives on a separate host from the REST API.
  return oandaBaseUrl().includes("fxtrade")
    ? "https://stream-fxtrade.oanda.com"
    : "https://stream-fxpractice.oanda.com";
}

interface OandaStreamPriceMsg {
  type: "PRICE" | "HEARTBEAT";
  instrument?: string;
  time?: string;
  bids?: { price: string }[];
  asks?: { price: string }[];
}

function dispatch(tick: StreamTick): void {
  const listeners = symbolListeners.get(tick.symbol);
  if (!listeners || listeners.size === 0) return;
  for (const fn of listeners) {
    try {
      fn(tick);
    } catch {
      /* one bad client must not stall the rest */
    }
  }
}

async function runStream(): Promise<void> {
  const accountId = oandaAccountId();
  const apiToken = token();
  if (!accountId || !apiToken) return;

  const instruments = TRADABLE_SYMBOLS
    .map((s) => toOandaInstrument(s))
    .filter((i): i is string => i != null);
  const url = `${streamBaseUrl()}/v3/accounts/${accountId}/pricing/stream?instruments=${instruments.join("%2C")}`;

  while (!stopRequested && symbolListeners.size > 0) {
    try {
      const res = await fetch(url, {
        headers: { authorization: `Bearer ${apiToken}` },
        // A long-lived chunked response — no timeout signal here.
      });
      if (!res.ok || !res.body) {
        throw new Error(`OANDA stream HTTP ${res.status}`);
      }
      reconnectDelayMs = 1000;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (!stopRequested) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let newlineIdx: number;
        while ((newlineIdx = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, newlineIdx).trim();
          buffer = buffer.slice(newlineIdx + 1);
          if (!line) continue;
          let msg: OandaStreamPriceMsg;
          try {
            msg = JSON.parse(line);
          } catch {
            continue;
          }
          if (msg.type !== "PRICE" || !msg.instrument) continue;
          const bid = msg.bids?.[0] ? Number(msg.bids[0].price) : NaN;
          const ask = msg.asks?.[0] ? Number(msg.asks[0].price) : NaN;
          if (!Number.isFinite(bid) || !Number.isFinite(ask)) continue;
          const time = msg.time ? Date.parse(msg.time) : Date.now();
          dispatch({
            symbol: fromOandaInstrument(msg.instrument),
            bid,
            ask,
            mid: (bid + ask) / 2,
            time: Number.isFinite(time) ? time : Date.now(),
          });
        }
        if (symbolListeners.size === 0) break;
      }
    } catch {
      /* fall through to reconnect backoff below */
    }
    if (stopRequested || symbolListeners.size === 0) break;
    await new Promise((r) => setTimeout(r, reconnectDelayMs));
    reconnectDelayMs = Math.min(reconnectDelayMs * 2, MAX_RECONNECT_DELAY_MS);
  }
  active = false;
}

function ensureStreamRunning(): void {
  if (active) return;
  active = true;
  stopRequested = false;
  void runStream();
}

/**
 * Subscribe to live ticks for a symbol (must be one of the fixed 20). Starts
 * the shared platform stream on first subscriber, tears it down when the
 * last subscriber across all symbols disconnects.
 */
export function subscribeOandaSymbolTicks(input: {
  symbol: string;
  onTick: TickListener;
}): () => void {
  const canonical = input.symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
  let set = symbolListeners.get(canonical);
  if (!set) {
    set = new Set();
    symbolListeners.set(canonical, set);
  }
  set.add(input.onTick);
  ensureStreamRunning();

  let closed = false;
  return () => {
    if (closed) return;
    closed = true;
    const listeners = symbolListeners.get(canonical);
    if (!listeners) return;
    listeners.delete(input.onTick);
    if (listeners.size === 0) symbolListeners.delete(canonical);
    if (symbolListeners.size === 0) stopRequested = true;
  };
}

/** Test/helper — drop all in-memory listeners and stop the shared stream. */
export function clearOandaStreamingCache(): void {
  symbolListeners.clear();
  stopRequested = true;
}
