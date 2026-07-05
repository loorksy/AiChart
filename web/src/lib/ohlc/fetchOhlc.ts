import { getKlines, type BinanceEnv } from "@/lib/binance";
import { executionToBinanceEnv } from "@/lib/executionEnv";
import {
  intervalPlan,
  normalizeInterval,
  resampleOhlc,
} from "@/lib/intervals";
import type { MarketType } from "@/lib/markets/types";
import { getSettings } from "@/lib/store";
import { getCached, setCached } from "@/lib/bridge/cache";
import { freshnessMeta, type FreshnessMeta } from "@/lib/bridge/freshness";
import {
  fetchOandaCandles,
  oandaAccountId,
  oandaConfigured,
} from "@/lib/markets/oanda";
import { isOandaDataOnly } from "@/lib/markets/forexDataSource";
import { forexCanonicalKey } from "@/lib/markets/forexCanonical";
import { fetchEaOhlc } from "@/lib/ohlc/eaOhlc";

export const OHLC_CACHE_TTL_MS = 45_000;
export const OHLC_MAX_LIMIT = 5000;

export interface OhlcCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export type OhlcSource = "binance" | "oanda" | "ea";

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
  hasMore?: boolean;
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
  /** Millisecond open time — fetch forex candles strictly before this (OANDA pagination). */
  beforeMs?: number;
  /** Inclusive range for Pro datafeed (milliseconds). */
  fromMs?: number;
  toMs?: number;
  /** Forex candle source: OANDA public data or the user's live EA/MT5 bridge. */
  source?: "oanda" | "ea";
}

export function ohlcCacheResource(symbol: string, interval: string): string {
  return `ohlc:${symbol.toUpperCase()}:${normalizeInterval(interval)}`;
}

async function fetchForexOhlcLive(
  symbol: string,
  interval: string,
  limit: number,
  opts?: { beforeMs?: number; fromMs?: number; toMs?: number },
): Promise<{ candles: OhlcCandle[]; source: OhlcSource; warning?: string; hasMore?: boolean }> {
  if (!oandaConfigured() || !oandaAccountId()) {
    return {
      candles: [],
      source: "oanda",
      warning: "OANDA غير مُعدّ — أضف OANDA_API_TOKEN و OANDA_ACCOUNT_ID.",
      hasMore: false,
    };
  }
  try {
    // Retry once on a transient OANDA failure (burst-load rate limits return a
    // momentary error) before surfacing it to the caller.
    let result: { candles: OhlcCandle[]; hasMore: boolean } | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        result = await fetchOandaCandles(symbol, interval, limit, opts);
        break;
      } catch (err) {
        if (attempt >= 1) throw err;
        await new Promise((r) => setTimeout(r, 350));
      }
    }
    const { candles, hasMore } = result!;
    if (candles.length > 0) {
      return {
        candles: opts?.fromMs != null ? candles : candles.slice(-limit),
        source: "oanda",
        hasMore,
      };
    }
    return {
      candles: [],
      source: "oanda",
      warning: "OANDA: لا شموع لهذا الرمز أو الفاصل الزمني.",
      hasMore: false,
    };
  } catch (e) {
    console.error("[oanda] candles failed", e);
    throw new Error("OANDA candles unavailable for this symbol/interval.");
  }
}

async function fetchCryptoOhlc(
  userId: number,
  symbol: string,
  interval: string,
  limit: number,
  cursor?: number,
): Promise<{ candles: OhlcCandle[]; nextCursor: number | null }> {
  const settings = userId > 0 ? await getSettings(userId) : null;
  const env: BinanceEnv = executionToBinanceEnv(
    settings?.execution_env_preference === "live" ? "live" : "demo",
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

/** Fetches OHLC with bridge cache (45s) — forex via OANDA, crypto via Binance. */
export async function fetchOhlc(options: FetchOhlcOptions): Promise<FetchOhlcResult> {
  const interval = normalizeInterval(options.interval ?? "1h");
  // Guests (userId <= 0) have no settings row — never touch getSettings for them
  // (it upserts a users-FK'd row). Market comes from the explicit option.
  const settings = options.userId > 0 ? await getSettings(options.userId) : null;
  const market = options.market ?? settings?.active_market ?? "crypto";
  const limit = Math.min(
    Math.max(1, options.limit ?? 200),
    OHLC_MAX_LIMIT,
  );

  const forexSource =
    market === "forex" && isOandaDataOnly()
      ? "oanda"
      : market === "forex"
        ? (options.source ?? "oanda")
        : "binance";
  const symbol =
    market === "forex" && forexSource === "oanda"
      ? forexCanonicalKey(options.symbol)
      : options.symbol.toUpperCase().trim();
  const sourceKey = forexSource;
  const cacheKey = `${ohlcCacheResource(symbol, interval)}:${sourceKey}`;
  if (
    !options.skipCache &&
    !options.cursor &&
    !options.beforeMs &&
    options.fromMs == null
  ) {
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
  let source: OhlcSource = market === "forex" ? "oanda" : "binance";
  let warning: string | undefined;
  let nextCursor: number | null = null;
  let hasMore = false;

  if (market === "forex") {
    const live =
      !isOandaDataOnly() && options.source === "ea"
        ? {
            ...(await fetchEaOhlc(options.userId, symbol, interval, {
              fromMs: options.fromMs,
              toMs: options.toMs,
              limit,
            })),
            source: "ea" as const,
            hasMore: false,
          }
        : await fetchForexOhlcLive(symbol, interval, limit, {
            beforeMs: options.beforeMs,
            fromMs: options.fromMs,
            toMs: options.toMs,
          });
    candles =
      options.fromMs != null ? live.candles : live.candles.slice(-limit);
    source = live.source;
    warning = live.warning;
    hasMore = live.hasMore ?? false;
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
    hasMore,
    freshness: freshnessMeta("live", 0),
  };

  if (!options.cursor && !options.beforeMs && options.fromMs == null) {
    await setCached(options.userId, cacheKey, result, OHLC_CACHE_TTL_MS);
  }

  return result;
}
