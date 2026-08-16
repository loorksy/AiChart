import { DEFAULT_MARKET, rejectNonForexMarket } from "@/lib/marketPolicy";
import { normalizeInterval } from "@/lib/intervals";
import type { MarketType } from "@/lib/markets/types";
import { freshnessMeta, type FreshnessMeta } from "@/lib/bridge/freshness";
import { fetchOandaCandles, oandaConfigured } from "@/lib/markets/oanda";
import { requireGold } from "@/lib/gold";

export interface OhlcCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

/** The one candle pipe: the platform's OANDA feed. */
export type OhlcSource = "oanda";

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
  /** Kept for call-site compatibility; OANDA is platform-level and ignores this. */
  userId: number;
  symbol: string;
  interval?: string;
  market?: MarketType;
  limit?: number;
  /** Millisecond open time — fetch candles strictly before this (pagination cursor). */
  cursor?: number;
  skipCache?: boolean;
  /** Millisecond open time — fetch forex candles strictly before this (pagination). */
  beforeMs?: number;
  /** Inclusive range for Pro datafeed (milliseconds). */
  fromMs?: number;
  toMs?: number;
  /** Kept for call-site compatibility; the only value is "oanda". */
  source?: OhlcSource;
}

/**
 * Fetches OHLC live, every call — from the platform's OANDA feed, the only
 * pipe. There is no cache and no staleness window here: the agent (and the
 * chart) always see OANDA's current answer, at whatever timeframe and
 * however far back it asks for. An unconfigured platform gets an empty
 * series with a warning, never a substitute feed. No user account link is
 * required or consulted for market data — see markets/marketDataSource.ts.
 */
export async function fetchOhlc(options: FetchOhlcOptions): Promise<FetchOhlcResult> {
  const interval = normalizeInterval(options.interval ?? "1h");
  const market = options.market ?? DEFAULT_MARKET;
  const marketBlock = rejectNonForexMarket(market);
  if (marketBlock) {
    throw new Error(marketBlock);
  }
  // Gold is the only instrument; a non-gold symbol reaching the candle pipe
  // is a caller bug, so it throws rather than silently returning gold data
  // under someone else's label.
  const symbol = requireGold(options.symbol);
  const limit = Math.max(1, options.limit ?? 200);

  if (!oandaConfigured()) {
    return {
      symbol,
      interval,
      market,
      candles: [],
      source: "oanda",
      cachedAt: Date.now(),
      ageMs: 0,
      fromCache: false,
      warning: "مزوّد بيانات OANDA غير مهيّأ على المنصة.",
      nextCursor: null,
      hasMore: false,
      freshness: freshnessMeta("live", 0),
    };
  }

  const toMs = options.toMs ?? options.beforeMs;
  let candles: OhlcCandle[] = [];
  let warning: string | undefined;
  let hasMore = false;
  try {
    const result = await fetchOandaCandles(symbol, interval, limit, {
      beforeMs: options.beforeMs,
      fromMs: options.fromMs,
      toMs,
    });
    candles = result.candles.map((c) => ({
      time: c.time,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume,
    }));
    hasMore = result.hasMore;
  } catch (e) {
    warning = e instanceof Error ? e.message : "تعذّر جلب الشموع من OANDA.";
  }

  const out = options.fromMs != null ? candles : candles.slice(-limit);

  return {
    symbol,
    interval,
    market,
    candles: out,
    source: "oanda",
    cachedAt: Date.now(),
    ageMs: 0,
    fromCache: false,
    warning,
    nextCursor: null,
    hasMore,
    freshness: freshnessMeta("live", 0),
  };
}
