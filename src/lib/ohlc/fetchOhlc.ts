import { DEFAULT_MARKET, rejectNonForexMarket } from "@/lib/marketPolicy";
import { normalizeInterval } from "@/lib/intervals";
import type { MarketType } from "@/lib/markets/types";
import { freshnessMeta, type FreshnessMeta } from "@/lib/bridge/freshness";
import { fetchMetaApiOhlc, fetchMetaApiOhlcRange } from "@/lib/ohlc/metaApiOhlc";

export interface OhlcCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

/** The one candle pipe: the user's own cloud MetaTrader account. */
export type OhlcSource = "metaapi";

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
  /** Millisecond open time — fetch forex candles strictly before this (pagination). */
  beforeMs?: number;
  /** Inclusive range for Pro datafeed (milliseconds). */
  fromMs?: number;
  toMs?: number;
  /** Kept for call-site compatibility; the only value is "metaapi". */
  source?: OhlcSource;
}

/**
 * Candles from whichever MetaTrader link the user has: the MetaApi cloud
 * account (history API, with range paging), or the self-hosted mt5local
 * bridge (latest-N bars only). Both are the USER'S OWN account — there is no
 * platform feed behind them.
 */
async function fetchAccountCandles(
  options: FetchOhlcOptions,
  symbol: string,
  interval: string,
  limit: number,
  toMs: number | undefined,
): Promise<{ candles: OhlcCandle[]; warning?: string }> {
  if (options.userId > 0) {
    const { getMtAccount } = await import("@/lib/store");
    const account = await getMtAccount(options.userId).catch(() => null);
    if (account?.metaapi_account_id === "mt5local") {
      try {
        const { mt5Rates } = await import("@/lib/mt5local/client");
        const bars = await mt5Rates(symbol, interval, limit, {
          login: account.login,
          server: account.server,
        });
        return {
          candles: (bars ?? [])
            .map((b) => ({
              // The bridge reports MT5 epoch seconds; candles here are ms.
              time: b.time < 1e12 ? b.time * 1000 : b.time,
              open: b.open,
              high: b.high,
              low: b.low,
              close: b.close,
            }))
            .filter((c) => Number.isFinite(c.time) && Number.isFinite(c.close))
            .sort((a, b) => a.time - b.time),
        };
      } catch (e) {
        return {
          candles: [],
          warning:
            e instanceof Error ? e.message : "تعذّر جلب الشموع من حاوية MT5.",
        };
      }
    }
  }
  return options.fromMs != null
    ? fetchMetaApiOhlcRange(options.userId, symbol, interval, {
        fromMs: options.fromMs,
        toMs,
      })
    : fetchMetaApiOhlc(options.userId, symbol, interval, { toMs, limit });
}

/**
 * Fetches OHLC live, every call — forex from the user's linked MetaTrader
 * account via MetaApi, the only pipe. There is no cache and no staleness
 * window here: the agent (and the chart) always sees the broker's own
 * current answer, at whatever timeframe and however far back it asks for.
 * An unlinked user gets an empty series with a warning naming the missing
 * link, never a substitute feed.
 */
export async function fetchOhlc(options: FetchOhlcOptions): Promise<FetchOhlcResult> {
  const interval = normalizeInterval(options.interval ?? "1h");
  const market = options.market ?? DEFAULT_MARKET;
  const marketBlock = rejectNonForexMarket(market);
  if (marketBlock) {
    throw new Error(marketBlock);
  }
  const limit = Math.max(1, options.limit ?? 200);

  /*
   * Broker feeds answer to the broker's own spelling — and that spelling is
   * case-sensitive. This line used to uppercase it, which is exactly what the
   * comment said not to do: Exness serves XAUUSDm, and MetaApi answers
   * "Symbol XAUUSDM does not exist" for the folded version.
   */
  let symbol = options.symbol.trim();
  if (options.userId > 0) {
    // Canonical chart keys (XAUUSD) must become the account's spelling
    // (XAUUSDm) before the RPC call — built from getSymbols(), never a suffix list.
    const { resolveBrokerSymbol } = await import("@/lib/markets/symbolCatalogue");
    symbol = await resolveBrokerSymbol(options.userId, symbol);
  }

  const toMs = options.toMs ?? options.beforeMs;
  const live = await fetchAccountCandles(options, symbol, interval, limit, toMs);

  const candles =
    options.fromMs != null ? live.candles : live.candles.slice(-limit);

  return {
    symbol,
    interval,
    market,
    candles,
    source: "metaapi",
    cachedAt: Date.now(),
    ageMs: 0,
    fromCache: false,
    warning: live.warning,
    nextCursor: null,
    hasMore: false,
    freshness: freshnessMeta("live", 0),
  };
}
