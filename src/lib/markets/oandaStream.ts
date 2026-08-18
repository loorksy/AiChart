/**
 * OANDA streaming pricing — one shared, platform-level connection for gold,
 * fanned out to however many SSE listeners are open.
 *
 * OANDA's v20 streaming endpoint takes its instrument list once at connect
 * time (no per-symbol subscribe/unsubscribe). With a single instrument that
 * is a perfect fit: one long-lived connection serves every user and every
 * open chart at once.
 */
import { oandaAccountId, oandaBaseUrl, toOandaInstrument, fromOandaInstrument } from "./oanda";
import { getPlatformValue } from "@/lib/platformConfig";
import { DATA_SYMBOL } from "@/lib/gold";

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

  const instruments = [toOandaInstrument(DATA_SYMBOL)].filter(
    (i): i is string => i != null,
  );
  const url = `${streamBaseUrl()}/v3/accounts/${accountId}/pricing/stream?instruments=${instruments.join("%2C")}`;

  while (!stopRequested && symbolListeners.size > 0) {
    const controller = new AbortController();
    let idle: ReturnType<typeof setTimeout> | null = null;
    const bumpIdle = () => {
      if (idle) clearTimeout(idle);
      idle = setTimeout(() => controller.abort(), 20_000);
    };
    try {
      bumpIdle();
      const res = await fetch(url, {
        headers: { authorization: `Bearer ${apiToken}` },
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        throw new Error(`OANDA stream HTTP ${res.status}`);
      }
      reconnectDelayMs = 1000;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (!stopRequested) {
        bumpIdle();
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
    } finally {
      if (idle) clearTimeout(idle);
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
 * Subscribe to live gold ticks. Starts the shared platform stream on the
 * first subscriber and tears it down when the last one disconnects.
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
