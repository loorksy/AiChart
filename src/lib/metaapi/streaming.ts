/**
 * MetaApi streaming connection — one per user, shared across chart tabs.
 *
 * Polling the forming candle can never match MT5 continuity. This module holds
 * getStreamingConnection + onSymbolPriceUpdated and fans ticks out to SSE
 * clients. Cost: one market-data subscription per open chart symbol per user;
 * unsubscribe when the last SSE client for that symbol goes away.
 */
import { getMetaApi } from "./client";
import { resolveBrokerSymbol } from "@/lib/markets/symbolCatalogue";
import { forexCanonicalKey } from "@/lib/markets/forexCanonical";
import { spreadFromBidAsk } from "@/lib/spread";
import { sessionAt } from "@/lib/strategies/sessionSpread";

export type StreamTick = {
  symbol: string;
  bid: number;
  ask: number;
  mid: number;
  time: number;
};

type TickListener = (tick: StreamTick) => void;

type StreamAccount = {
  getStreamingConnection: () => StreamConnection;
  deploy: () => Promise<void>;
  waitDeployed: (timeoutInSeconds?: number) => Promise<void>;
  waitConnected: (timeoutInSeconds?: number) => Promise<void>;
  state: string;
  connectionStatus: string;
};

type StreamConnection = {
  connect: () => Promise<void>;
  waitSynchronized: (timeoutInSeconds?: number) => Promise<unknown>;
  addSynchronizationListener: (listener: {
    onSymbolPriceUpdated?: (
      instanceIndex: string,
      price: { symbol?: string; bid?: number; ask?: number; time?: number | string | Date },
    ) => Promise<void> | void;
  }) => void;
  removeSynchronizationListener?: (listener: unknown) => void;
  subscribeToMarketData: (
    symbol: string,
    subscriptions: Array<{ type: string; intervalInMilliseconds?: number }>,
  ) => Promise<unknown>;
  unsubscribeFromMarketData: (
    symbol: string,
    subscriptions: Array<{ type: string }>,
  ) => Promise<unknown>;
  close?: () => Promise<void>;
};

type UserStream = {
  connectionPromise: Promise<StreamConnection>;
  connection: StreamConnection | null;
  /** symbol → Set of SSE/datafeed listeners */
  symbolListeners: Map<string, Set<TickListener>>;
  listener: {
    onSymbolPriceUpdated: (
      instanceIndex: string,
      price: { symbol?: string; bid?: number; ask?: number; time?: number | string | Date },
    ) => Promise<void>;
  };
};

const streams = new Map<number, UserStream>();

/**
 * Throttled `cost_samples` writer — the live-cost profile's only production
 * feeder since the EA bridge was removed. One sample per canonical symbol per
 * minute, taken from ticks the stream is already receiving for open charts,
 * so the session profiles (cost ladder rungs 2–3) fill without any extra
 * broker round trip. Fire-and-forget: a failed insert must never disturb the
 * tick fan-out.
 */
const COST_SAMPLE_INTERVAL_MS = 60_000;
const costSampleLastAt = new Map<string, number>();

function recordCostSample(tick: StreamTick): void {
  const canonical = forexCanonicalKey(tick.symbol);
  if (!canonical) return;
  const now = Date.now();
  const last = costSampleLastAt.get(canonical) ?? 0;
  if (now - last < COST_SAMPLE_INTERVAL_MS) return;
  costSampleLastAt.set(canonical, now);
  const info = spreadFromBidAsk(tick.bid, tick.ask, canonical);
  // An implausible pips figure (wrong pip convention for the instrument)
  // must not poison the measured profile — skip it, the throttle stamp above
  // stands so the symbol is retried next minute.
  if (!info || !Number.isFinite(info.spreadPips) || info.spreadPips < 0) return;
  if (info.spreadPipsReliable === false) return;
  void (async () => {
    const { execute } = await import("@/lib/db");
    await execute(
      "INSERT INTO cost_samples (symbol, session, spread_pips, observed_at) VALUES (?,?,?,?)",
      [canonical, sessionAt(new Date(now)), Number(info.spreadPips.toFixed(3)), now],
    );
  })().catch(() => {
    /* failure-safe by contract */
  });
}

function tickTimeMs(raw: number | string | Date | undefined): number {
  if (raw instanceof Date) return raw.getTime();
  if (typeof raw === "number" && Number.isFinite(raw)) {
    // MetaApi sometimes reports seconds.
    return raw < 1e12 ? raw * 1000 : raw;
  }
  if (typeof raw === "string") {
    const parsed = Date.parse(raw);
    if (Number.isFinite(parsed)) return parsed;
  }
  return Date.now();
}

async function ensureStream(userId: number, metaapiAccountId: string): Promise<UserStream> {
  const existing = streams.get(userId);
  if (existing) return existing;

  const entry: UserStream = {
    connectionPromise: null as unknown as Promise<StreamConnection>,
    connection: null,
    symbolListeners: new Map(),
    listener: {
      async onSymbolPriceUpdated(_instanceIndex, price) {
        const symbol = typeof price.symbol === "string" ? price.symbol : "";
        if (!symbol) return;
        const bid = Number(price.bid);
        const ask = Number(price.ask);
        if (!Number.isFinite(bid) || !Number.isFinite(ask)) return;
        const tick: StreamTick = {
          symbol,
          bid,
          ask,
          mid: (bid + ask) / 2,
          time: tickTimeMs(price.time),
        };
        // Feed the live-cost profile before the fan-out: a tick with no SSE
        // listener left is still a real observation of the broker's book.
        recordCostSample(tick);
        const listeners = entry.symbolListeners.get(symbol);
        if (!listeners) return;
        for (const fn of listeners) {
          try {
            fn(tick);
          } catch {
            /* one bad client must not stall the rest */
          }
        }
      },
    },
  };

  entry.connectionPromise = (async () => {
    const api = await getMetaApi();
    const account = (await api.metatraderAccountApi.getAccount(
      metaapiAccountId,
    )) as unknown as StreamAccount;
    if (account.state !== "DEPLOYED") {
      await account.deploy();
      await account.waitDeployed(120);
    }
    if (account.connectionStatus !== "CONNECTED") {
      await account.waitConnected(120);
    }
    const conn = account.getStreamingConnection();
    conn.addSynchronizationListener(entry.listener);
    await conn.connect();
    await conn.waitSynchronized(60);
    entry.connection = conn;
    return conn;
  })();

  streams.set(userId, entry);
  entry.connectionPromise.catch(() => {
    if (streams.get(userId) === entry) streams.delete(userId);
  });
  return entry;
}

/**
 * Subscribe to quote ticks for a broker symbol. Returns an unsubscribe that
 * drops this listener and, when it was the last one for the symbol, cancels
 * the MetaApi market-data subscription.
 */
export async function subscribeSymbolTicks(input: {
  userId: number;
  metaapiAccountId: string;
  symbol: string;
  onTick: TickListener;
}): Promise<() => void> {
  const brokerSymbol = await resolveBrokerSymbol(input.userId, input.symbol);
  const entry = await ensureStream(input.userId, input.metaapiAccountId);
  const conn = await entry.connectionPromise;

  let set = entry.symbolListeners.get(brokerSymbol);
  const first = !set || set.size === 0;
  if (!set) {
    set = new Set();
    entry.symbolListeners.set(brokerSymbol, set);
  }
  set.add(input.onTick);

  if (first) {
    await conn.subscribeToMarketData(brokerSymbol, [
      { type: "quotes", intervalInMilliseconds: 200 },
    ]);
  }

  let closed = false;
  return () => {
    if (closed) return;
    closed = true;
    const listeners = entry.symbolListeners.get(brokerSymbol);
    if (!listeners) return;
    listeners.delete(input.onTick);
    if (listeners.size > 0) return;
    entry.symbolListeners.delete(brokerSymbol);
    void conn
      .unsubscribeFromMarketData(brokerSymbol, [{ type: "quotes" }])
      .catch(() => undefined);
  };
}

/** Test/helper — drop the in-memory stream for a user (does not undeploy). */
export function clearStreamingCache(userId?: number): void {
  if (userId != null) {
    streams.delete(userId);
    return;
  }
  streams.clear();
}
