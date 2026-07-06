import { DEFAULT_MARKET, rejectNonForexMarket } from "@/lib/marketPolicy";
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

export type OhlcSource = "oanda" | "ea";

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

/** Fetches OHLC with bridge cache (45s) — forex via OANDA or EA. */
export async function fetchOhlc(options: FetchOhlcOptions): Promise<FetchOhlcResult> {
  const interval = normalizeInterval(options.interval ?? "1h");
  const settings = options.userId > 0 ? await getSettings(options.userId) : null;
  const market = options.market ?? settings?.active_market ?? DEFAULT_MARKET;
  const marketBlock = rejectNonForexMarket(market);
  if (marketBlock) {
    throw new Error(marketBlock);
  }
  const limit = Math.min(
    Math.max(1, options.limit ?? 200),
    OHLC_MAX_LIMIT,
  );

  const forexSource =
    isOandaDataOnly()
      ? "oanda"
      : (options.source ?? "oanda");
  const symbol =
    forexSource === "oanda"
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
  let source: OhlcSource = "oanda";
  let warning: string | undefined;
  let nextCursor: number | null = null;
  let hasMore = false;

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
