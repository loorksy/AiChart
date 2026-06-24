import { getKlines, type BinanceEnv } from "@/lib/binance";
import { queueEaGetOhlc } from "@/lib/eaAgentCommands";
import { getEaCandles, getEaCandlesResolved } from "@/lib/eaStore";
import { executionToBinanceEnv } from "@/lib/executionEnv";
import {
  intervalPlan,
  mt5IntervalPlan,
  normalizeInterval,
  resampleOhlc,
} from "@/lib/intervals";
import type { MarketType } from "@/lib/markets/types";
import { resolveMt5Symbol } from "@/lib/mt5SymbolMap";
import { mt5Rates } from "@/lib/mt5local/client";
import {
  getMtAccount,
  getMtAccountMeta,
  getSettings,
  resolveForexBackendForUser,
} from "@/lib/store";
import type { EaGetOhlcResult } from "@/lib/types";
import { getCached, setCached } from "@/lib/bridge/cache";
import { freshnessMeta, type FreshnessMeta } from "@/lib/bridge/freshness";
import { getMetaApi } from "@/lib/metaapi/client";

export const OHLC_CACHE_TTL_MS = 45_000;
export const OHLC_MAX_LIMIT = 500;

export interface OhlcCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export type OhlcSource =
  | "mt5_ohlc"
  | "binance"
  | "heartbeat_cache"
  | "mt5local"
  | "metaapi";

export interface FetchOhlcResult {
  symbol: string;
  interval: string;
  market: MarketType;
  candles: OhlcCandle[];
  source: OhlcSource;
  cachedAt: number | null;
  ageMs: number | null;
  fromCache: boolean;
  warning?: string;
  nextCursor?: number | null;
  freshness?: FreshnessMeta;
}

export interface FetchOhlcOptions {
  userId: number;
  symbol: string;
  interval?: string;
  market?: MarketType;
  limit?: number;
  /** Millisecond open time — fetch candles strictly before this (crypto pagination). */
  cursor?: number;
  skipCache?: boolean;
  /** Forex: return EA heartbeat cache immediately without blocking on get_ohlc. */
  preferCache?: boolean;
}

export function ohlcCacheResource(symbol: string, interval: string): string {
  return `ohlc:${symbol.toUpperCase()}:${normalizeInterval(interval)}`;
}

function normalizeEaCandles(raw: unknown[]): OhlcCandle[] {
  return raw
    .map((row) => {
      const c = row as Record<string, unknown>;
      const time = Number(c.time ?? c.openTime ?? c.t ?? 0);
      const open = Number(c.open ?? c.o ?? 0);
      const high = Number(c.high ?? c.h ?? 0);
      const low = Number(c.low ?? c.l ?? 0);
      const close = Number(c.close ?? c.c ?? 0);
      if (!time || !open) return null;
      return {
        time,
        open,
        high,
        low,
        close,
        volume: c.volume != null ? Number(c.volume) : undefined,
      };
    })
    .filter(Boolean) as OhlcCandle[];
}

async function fetchMetaApiForexCandles(
  userId: number,
  symbol: string,
  interval: string,
  limit: number,
): Promise<OhlcCandle[]> {
  const row = await getMtAccount(userId);
  if (!row?.metaapi_account_id) return [];

  const api = await getMetaApi();
  const account = await api.metatraderAccountApi.getAccount(row.metaapi_account_id);
  if (account.state !== "DEPLOYED") return [];

  const resolved = (await resolveMt5Symbol(userId, symbol)) ?? symbol;
  const { base: tf, factor } = mt5IntervalPlan(interval);
  const baseLimit = Math.min(limit * factor, OHLC_MAX_LIMIT);
  const raw = (await account.getHistoricalCandles(
    resolved,
    tf,
    undefined,
    baseLimit,
  )) as Array<{
    time: string | Date;
    open: number;
    high: number;
    low: number;
    close: number;
  }>;

  const baseCandles = raw
    .map((c) => ({
      time: Math.floor(new Date(c.time as string | Date).getTime() / 1000),
      open: Number(c.open),
      high: Number(c.high),
      low: Number(c.low),
      close: Number(c.close),
    }))
    .filter((b) => Number.isFinite(b.time) && b.time > 0)
    .sort((a, b) => a.time - b.time);

  return resampleOhlc(baseCandles, factor) as OhlcCandle[];
}

async function fetchForexOhlcFromEaCache(
  userId: number,
  symbol: string,
  interval: string,
  limit: number,
): Promise<{ candles: OhlcCandle[]; source: OhlcSource } | null> {
  const mt5Symbol = (await resolveMt5Symbol(userId, symbol)) ?? symbol;
  const { base: eaInterval, factor } = mt5IntervalPlan(interval);
  const cached = await getEaCandlesResolved(userId, mt5Symbol, eaInterval);
  if (!cached) return null;
  try {
    const baseCandles = normalizeEaCandles(JSON.parse(cached.candles_json) as unknown[]);
    if (baseCandles.length === 0) return null;
    const candles = resampleOhlc(baseCandles, factor) as OhlcCandle[];
    return {
      candles: candles.slice(-limit),
      source: "heartbeat_cache",
    };
  } catch {
    return null;
  }
}

async function fetchForexOhlcLive(
  userId: number,
  symbol: string,
  interval: string,
  limit: number,
  preferCache = false,
): Promise<{ candles: OhlcCandle[]; source: OhlcSource; warning?: string }> {
  const backend = await resolveForexBackendForUser(userId);

  if (backend === "metaapi") {
    const candles = await fetchMetaApiForexCandles(userId, symbol, interval, limit);
    if (candles.length > 0) {
      return { candles: candles.slice(-limit), source: "metaapi" };
    }
    return {
      candles: [],
      source: "metaapi",
      warning: "MetaApi: no candles — verify account is deployed and symbol exists.",
    };
  }

  if (backend === "mt5local") {
    const acct = await getMtAccountMeta(userId);
    if (!acct) {
      return { candles: [], source: "mt5local", warning: "MT5 غير مربوط." };
    }
    const bars = await mt5Rates(symbol, interval, limit, {
      login: acct.login,
      server: acct.server,
    });
    return {
      candles: bars.map((b) => ({
        time: b.time,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
      })),
      source: "mt5local",
    };
  }

  const mt5Symbol = (await resolveMt5Symbol(userId, symbol)) ?? symbol;
  const { base: eaInterval, factor } = mt5IntervalPlan(interval);

  if (preferCache) {
    const hit = await fetchForexOhlcFromEaCache(userId, symbol, interval, limit);
    if (hit && hit.candles.length > 0) {
      return {
        ...hit,
        warning: "عرض سريع من كاش EA — جاري تحديث الشموع…",
      };
    }
  }

  const baseCount = Math.min(limit * factor, OHLC_MAX_LIMIT);
  const ack = await queueEaGetOhlc(
    userId,
    { symbol: mt5Symbol, timeframe: eaInterval, count: baseCount },
    preferCache ? 4_000 : 12_000,
  );

  if (ack.ok && ack.result) {
    const result = ack.result as unknown as EaGetOhlcResult;
    const baseCandles = normalizeEaCandles(result.candles ?? []);
    if (baseCandles.length > 0) {
      const candles = resampleOhlc(baseCandles, factor) as OhlcCandle[];
      return { candles, source: "mt5_ohlc" };
    }
  }

  const cached = await getEaCandlesResolved(userId, mt5Symbol, eaInterval);
  if (cached) {
    try {
      const baseCandles = normalizeEaCandles(JSON.parse(cached.candles_json) as unknown[]);
      if (baseCandles.length > 0) {
        const candles = resampleOhlc(baseCandles, factor) as OhlcCandle[];
        return {
          candles: candles.slice(-limit),
          source: "heartbeat_cache",
          warning:
            ack.reason ??
            "EA get_ohlc unavailable — using heartbeat candle cache until EA v4 is installed.",
        };
      }
    } catch {
      /* fall through */
    }
  }

  throw new Error(
    ack.reason ??
      "No OHLC data — install EA v4 with get_ohlc or wait for heartbeat candles.",
  );
}

async function fetchCryptoOhlc(
  userId: number,
  symbol: string,
  interval: string,
  limit: number,
  cursor?: number,
): Promise<{ candles: OhlcCandle[]; nextCursor: number | null }> {
  const settings = await getSettings(userId);
  const env: BinanceEnv = executionToBinanceEnv(
    settings.execution_env_preference === "live" ? "live" : "demo",
  );

  const sym = symbol.toUpperCase();
  // Derived intervals (e.g. 2w, 10m) aren't native on Binance — fetch the base
  // interval and aggregate. factor=1 is the native passthrough.
  const { base: tf, factor } = intervalPlan(interval);
  const baseLimit = Math.min(limit * factor, OHLC_MAX_LIMIT);

  if (cursor && Number.isFinite(cursor)) {
    const base = env === "testnet"
      ? "https://testnet.binance.vision"
      : "https://api.binance.com";
    const url = `${base}/api/v3/klines?symbol=${encodeURIComponent(sym)}&interval=${encodeURIComponent(tf)}&limit=${baseLimit}&endTime=${cursor - 1}`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      throw new Error(`Binance klines failed for ${sym}`);
    }
    const rows = (await res.json()) as unknown[][];
    const baseCandles = rows.map((r) => ({
      time: Number(r[0]),
      open: Number(r[1]),
      high: Number(r[2]),
      low: Number(r[3]),
      close: Number(r[4]),
      volume: Number(r[5]),
    }));
    const candles = resampleOhlc(baseCandles, factor) as OhlcCandle[];
    const nextCursor = baseCandles.length > 0 ? baseCandles[0]!.time : null;
    return { candles, nextCursor };
  }

  const rows = await getKlines(sym, tf, baseLimit, env);
  const baseCandles = rows.map((r) => ({
    time: r.openTime,
    open: r.open,
    high: r.high,
    low: r.low,
    close: r.close,
    volume: r.volume,
  }));
  const candles = resampleOhlc(baseCandles, factor) as OhlcCandle[];
  const nextCursor = baseCandles.length > 0 ? baseCandles[0]!.time : null;
  return { candles, nextCursor };
}

/** Fetches OHLC with bridge cache (45s) — forex via EA get_ohlc, crypto via Binance. */
export async function fetchOhlc(options: FetchOhlcOptions): Promise<FetchOhlcResult> {
  const symbol = options.symbol.toUpperCase().trim();
  const interval = normalizeInterval(options.interval ?? "1h");
  const settings = await getSettings(options.userId);
  const market = options.market ?? settings.active_market ?? "crypto";
  const limit = Math.min(
    Math.max(1, options.limit ?? 200),
    OHLC_MAX_LIMIT,
  );

  const cacheKey = ohlcCacheResource(symbol, interval);
  if (!options.skipCache && !options.cursor) {
    const hit = await getCached<FetchOhlcResult>(options.userId, cacheKey);
    if (hit.fromCache) {
      return {
        ...hit.value,
        cachedAt: hit.cachedAt,
        ageMs: hit.ageMs,
        fromCache: true,
      };
    }
  }

  let candles: OhlcCandle[] = [];
  let source: OhlcSource = market === "forex" ? "mt5_ohlc" : "binance";
  let warning: string | undefined;
  let nextCursor: number | null = null;

  if (market === "forex") {
    const live = await fetchForexOhlcLive(
      options.userId,
      symbol,
      interval,
      limit,
      Boolean(options.preferCache),
    );
    candles = live.candles.slice(-limit);
    source = live.source;
    warning = live.warning;
  } else {
    const crypto = await fetchCryptoOhlc(
      options.userId,
      symbol,
      interval,
      limit,
      options.cursor,
    );
    candles = crypto.candles;
    nextCursor = crypto.nextCursor;
  }

  const result: FetchOhlcResult = {
    symbol,
    interval,
    market,
    candles,
    source,
    cachedAt: Date.now(),
    ageMs: 0,
    fromCache: false,
    warning,
    nextCursor,
    freshness: freshnessMeta(
      source === "heartbeat_cache" ? "cache" : "live",
      0,
    ),
  };

  if (!options.cursor) {
    await setCached(options.userId, cacheKey, result, OHLC_CACHE_TTL_MS);
  }

  return result;
}
