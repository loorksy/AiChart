import { DEFAULT_MARKET, rejectNonForexMarket } from "@/lib/marketPolicy";
import {
  intervalPlan,
  normalizeInterval,
  resampleOhlc,
} from "@/lib/intervals";
import type { MarketType } from "@/lib/markets/types";
import { getCached, setCached } from "@/lib/bridge/cache";
import { freshnessMeta, type FreshnessMeta } from "@/lib/bridge/freshness";
import {
  fetchOandaCandles,
  oandaAccountId,
  oandaConfigured,
} from "@/lib/markets/oanda";
import { forexCanonicalKey } from "@/lib/markets/forexCanonical";
import { ohlcCacheTtlMs } from "@/lib/markets/intervals";
import { fetchMetaApiOhlc } from "@/lib/ohlc/metaApiOhlc";

/** @deprecated Prefer interval-aware {@link ohlcCacheTtlMs}. Kept for callers. */
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

export type OhlcSource = "oanda" | "metaapi";

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
  /** Millisecond open time — fetch candles strictly before this (pagination cursor). */
  cursor?: number;
  skipCache?: boolean;
  /** Millisecond open time — fetch forex candles strictly before this (OANDA pagination). */
  beforeMs?: number;
  /** Inclusive range for Pro datafeed (milliseconds). */
  fromMs?: number;
  toMs?: number;
  /** Forex candle source: the platform's OANDA feed, or the cloud MetaTrader account via MetaApi. */
  source?: OhlcSource;
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

/** Fetches OHLC with bridge cache (45s) — forex via OANDA or MetaApi. */
export async function fetchOhlc(options: FetchOhlcOptions): Promise<FetchOhlcResult> {
  const interval = normalizeInterval(options.interval ?? "1h");
  const market = options.market ?? DEFAULT_MARKET;
  const marketBlock = rejectNonForexMarket(market);
  if (marketBlock) {
    throw new Error(marketBlock);
  }
  const limit = Math.min(
    Math.max(1, options.limit ?? 200),
    OHLC_MAX_LIMIT,
  );

  /*
   * The caller's source wins, and absent one it is the platform feed. Only
   * two call sites pass a source at all: the chart's klines route, which
   * takes it from resolveMarketDataSource and therefore never names a pipe
   * the account has not connected, and the layout route, which hardcodes
   * "oanda".
   */
  const forexSource: OhlcSource = options.source ?? "oanda";
  let symbol =
    forexSource === "oanda"
      ? forexCanonicalKey(options.symbol)
      : /*
         * Broker feeds answer to the broker's own spelling — and that spelling
         * is case-sensitive. This line used to uppercase it, which is exactly
         * what the comment said not to do: Exness serves XAUUSDm, and MetaApi
         * answers "Symbol XAUUSDM does not exist" for the folded version.
         */
        options.symbol.trim();
  if (forexSource === "metaapi" && options.userId > 0) {
    // Canonical chart keys (XAUUSD) must become the account's spelling
    // (XAUUSDm) before the RPC call — built from getSymbols(), never a suffix list.
    const { resolveBrokerSymbol } = await import("@/lib/markets/symbolCatalogue");
    symbol = await resolveBrokerSymbol(options.userId, symbol);
  }
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
  let source: OhlcSource = "oanda";
  const nextCursor: number | null = null;
  let hasMore = false;

  const live =
    forexSource === "metaapi"
      ? {
          ...(await fetchMetaApiOhlc(options.userId, symbol, interval, {
            toMs: options.toMs,
            limit,
          })),
          source: "metaapi" as const,
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
  const warning: string | undefined = live.warning;
  hasMore = live.hasMore ?? false;

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
    await setCached(options.userId, cacheKey, result, ohlcCacheTtlMs(interval));
  }

  return result;
}
