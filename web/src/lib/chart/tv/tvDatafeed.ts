import type {
  Bar,
  DatafeedConfiguration,
  HistoryCallback,
  IBasicDataFeed,
  LibrarySymbolInfo,
  PeriodParams,
  ResolutionString,
  ResolveCallback,
  SearchSymbolResultItem,
  SubscribeBarsCallback,
} from "@/vendor/tradingview/charting_library";
import type { MarketType } from "@/lib/markets/types";
import { barDurationMs } from "@/lib/intervals";
import {
  getKlinesClientCache,
  setKlinesClientCache,
  klinesClientKey,
} from "@/lib/ohlc/klinesClientCache";

/** OANDA rejects ranges over ~5000 candles with HTTP 400 — stay safely under. */
const MAX_BARS_PER_REQUEST = 4000;

/** Build the /api/market/klines query. `fresh` is OMITTED unless explicitly
 *  requested — normal history reads go through the warehouse/cache; only a
 *  manual refresh or the live forming candle sets fresh=1. */
export function buildKlinesUrl(params: {
  symbol: string;
  interval: string;
  market?: MarketType;
  limit?: number;
  from?: number;
  to?: number;
  ea?: boolean;
  fresh?: boolean;
}): string {
  const search = new URLSearchParams({
    symbol: stripEaPrefix(params.symbol),
    interval: params.interval,
    market: params.market ?? "forex",
  });
  if (params.ea) search.set("source", "ea");
  if (params.limit != null) search.set("limit", String(params.limit));
  if (params.from != null) search.set("from", String(params.from));
  if (params.to != null) search.set("to", String(params.to));
  // IMPORTANT: do NOT set fresh=1 for normal getBars — it bypasses the cache
  // and warehouse. Only manual refresh / latest-candle polling passes fresh.
  if (params.fresh) search.set("fresh", "1");
  return `/api/market/klines?${search.toString()}`;
}

/** TradingView resolution → AiChart interval (klines API). */
const RES_TO_INTERVAL: Record<string, string> = {
  "1": "1m",
  "3": "3m",
  "5": "5m",
  "15": "15m",
  "30": "30m",
  "60": "1h",
  "120": "2h",
  "240": "4h",
  "1D": "1d",
  D: "1d",
  "1W": "1w",
  W: "1w",
};

const SUPPORTED_RESOLUTIONS = [
  "1",
  "5",
  "15",
  "30",
  "60",
  "240",
  "1D",
  "1W",
] as ResolutionString[];

function resolutionToInterval(res: string): string {
  return RES_TO_INTERVAL[res] ?? "15m";
}

/**
 * How often the forming candle is refetched.
 *
 * A minute chart repainting every 5s reads as frozen next to MT5, where price
 * moves continuously — the bar would sit still for most of its own life. The
 * tail is 2 bars and the response is small, so the short intervals are cheap;
 * the longer ones stay slow because a 4h bar gains nothing from a fast poll.
 */
function pollMsForResolution(res: string): number {
  const iv = resolutionToInterval(res);
  if (iv === "1m") return 1_000;
  if (iv === "3m" || iv === "5m") return 2_000;
  if (iv === "15m" || iv === "30m") return 5_000;
  if (iv === "1h" || iv === "2h") return 10_000;
  return 30_000;
}

interface RawCandle {
  time: number; // seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface TvLatestCandle {
  symbol: string;
  interval: string;
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

function priceScale(symbol: string): number {
  const s = symbol.toUpperCase();
  if (s.includes("JPY")) return 1000; // 3 decimals
  if (s.includes("XAU") || s.includes("XAG")) return 100; // metals, 2 decimals
  return 100000; // forex majors, 5 decimals
}

/** EA (broker) symbols are namespaced inside TV with this ticker prefix. */
export const EA_TICKER_PREFIX = "EA:";
const EA_EXCHANGE = "MT5";
/** Bars served by the trader's cloud MetaTrader account, via MetaApi. */
const CLOUD_EXCHANGE = "MT5 CLOUD";
/** Resolutions the EA bridge serves natively (MT5 periods). */
const EA_RESOLUTIONS = ["1", "5", "15", "30", "60", "240", "1D", "1W"] as ResolutionString[];

export function isEaTicker(t: string | undefined): boolean {
  return Boolean(t && t.startsWith(EA_TICKER_PREFIX));
}

export function stripEaPrefix(t: string): string {
  return t.startsWith(EA_TICKER_PREFIX) ? t.slice(EA_TICKER_PREFIX.length) : t;
}

/** Datafeed backed by AiChart's own /api/market/klines + /api/instruments. */
export function createAiChartDatafeed(
  market: MarketType = "forex",
  opts: { eaEnabled?: boolean; onLatestCandle?: (candle: TvLatestCandle) => void } = {},
): IBasicDataFeed {
  const exchange = "OANDA";
  const symbolType = "forex";
  const eaEnabled = Boolean(opts.eaEnabled);
  const subscribers = new Map<string, ReturnType<typeof setInterval>>();

  const config: DatafeedConfiguration = {
    supported_resolutions: SUPPORTED_RESOLUTIONS,
    exchanges: eaEnabled
      ? [
          { value: "", name: "الكل", desc: "" },
          { value: exchange, name: exchange, desc: exchange },
          { value: EA_EXCHANGE, name: "وسيطك (MT5)", desc: "Your broker via EA" },
        ]
      : [{ value: exchange, name: exchange, desc: exchange }],
    symbols_types: [{ name: symbolType, value: symbolType }],
  };

  async function fetchCandles(
    symbol: string,
    interval: string,
    opts2: {
      from?: number;
      to?: number;
      limit?: number;
      ea?: boolean;
      /** Only true for manual refresh / the live forming candle. */
      fresh?: boolean;
    },
  ): Promise<{ candles: RawCandle[]; failed: boolean }> {
    const opts = opts2;
    const url = buildKlinesUrl({
      symbol,
      interval,
      market,
      limit: opts.limit,
      from: opts.from,
      to: opts.to,
      ea: opts.ea,
      fresh: opts.fresh,
    });
    // Transient upstream blips (OANDA rate-limit under burst load) are retried
    // HERE, silently — surfacing onError would flash TV's "network error"
    // badge for a one-off hiccup.
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await fetch(url, {
          cache: "no-store",
        });
        if (res.ok) {
          const data = (await res.json()) as {
            candles?: RawCandle[];
            error?: string;
            pending?: boolean;
          };
          const candles = data.candles ?? [];
          const blip =
            candles.length === 0 &&
            (Boolean(data.error) || Boolean(data.pending));
          if (!blip) return { candles, failed: false };
        }
      } catch {
        /* network hiccup — retry */
      }
      if (attempt < 3) await new Promise((r) => setTimeout(r, 400 * attempt));
    }
    return { candles: [], failed: true };
  }

  return {
    onReady: (callback) => {
      setTimeout(() => callback(config), 0);
    },

    searchSymbols: async (userInput, exchangeFilter, _symbolType, onResult) => {
      const wantOanda = !exchangeFilter || exchangeFilter === exchange;
      const wantEa = eaEnabled && (!exchangeFilter || exchangeFilter === EA_EXCHANGE);
      const items: SearchSymbolResultItem[] = [];

      const loadOanda = async () => {
        if (!wantOanda) return;
        try {
          const params = new URLSearchParams({ market, q: userInput, wrapped: "1" });
          const res = await fetch(`/api/instruments?${params}`, { cache: "no-store" });
          const data = (await res.json()) as { instruments?: { symbol: string }[] };
          for (const r of (data.instruments ?? []).slice(0, 50)) {
            items.push({
              symbol: r.symbol,
              description: r.symbol,
              exchange,
              ticker: r.symbol,
              type: symbolType,
            });
          }
        } catch {
          /* keep other source */
        }
      };

      const loadEa = async () => {
        if (!wantEa) return;
        try {
          const params = new URLSearchParams({ source: "ea", q: userInput });
          const res = await fetch(`/api/instruments?${params}`, { cache: "no-store" });
          if (!res.ok) return;
          const data = (await res.json()) as {
            instruments?: { symbol: string; description?: string }[];
          };
          for (const r of (data.instruments ?? []).slice(0, 100)) {
            items.push({
              symbol: r.symbol,
              description: r.description || r.symbol,
              exchange: EA_EXCHANGE,
              ticker: `${EA_TICKER_PREFIX}${r.symbol}`,
              type: symbolType,
            });
          }
        } catch {
          /* keep other source */
        }
      };

      await Promise.all([loadOanda(), loadEa()]);
      onResult(items);
    },

    resolveSymbol: (symbolName, onResolve: ResolveCallback, onError) => {
      // Broker symbols arrive as "EA:EURUSDm" or "MT5:EURUSDm" — keep the EA
      // namespace in the ticker so getBars routes to the broker bridge, and
      // preserve broker-exact case (Exness EURUSDm).
      const viaEa =
        symbolName.startsWith(EA_TICKER_PREFIX) ||
        symbolName.startsWith(`${EA_EXCHANGE}:`);
      const bare = symbolName.includes(":")
        ? symbolName.split(":").pop()!
        : symbolName;
      /*
       * Case is only folded for the platform feed's canonical keys. A broker
       * symbol arrives already spelled the way its catalogue spells it —
       * XAUUSDm, AAPLm — and uppercasing it here is what reached MetaApi as a
       * symbol that does not exist. A lowercase letter is the tell: canonical
       * OANDA keys never carry one.
       */
      const sym = viaEa || /[a-z]/.test(bare) ? bare : bare.toUpperCase();
      const tickerOut = viaEa ? `${EA_TICKER_PREFIX}${sym}` : sym;
      /*
       * The header prints this, so it has to name the feed the bars actually
       * came from. It said OANDA for every symbol, including one served by the
       * trader's own cloud account — the reported "I picked cloud and it still
       * says OANDA". Same lowercase tell as above: a broker catalogue spells
       * XAUUSDm, a canonical platform key never does.
       */
      const exch = viaEa
        ? EA_EXCHANGE
        : /[a-z]/.test(sym)
          ? CLOUD_EXCHANGE
          : exchange;
      const info: LibrarySymbolInfo = {
        name: sym,
        ticker: tickerOut,
        description: viaEa ? `${sym} · وسيطك` : sym,
        type: symbolType,
        session: "24x7",
        exchange: exch,
        listed_exchange: exch,
        timezone: "Etc/UTC",
        format: "price",
        minmov: 1,
        pricescale: priceScale(sym),
        has_intraday: true,
        has_weekly_and_monthly: true,
        // Every resolution is served NATIVELY by our klines API. Without these,
        // TV assumes only 1-minute data exists and requests 1m for a 15m chart
        // (weeks of 1m bars → clamped window → "empty" higher timeframes).
        intraday_multipliers: viaEa
          ? ["1", "5", "15", "30", "60", "240"]
          : ["1", "3", "5", "15", "30", "60", "120", "240"],
        daily_multipliers: ["1"],
        weekly_multipliers: ["1"],
        monthly_multipliers: ["1"],
        supported_resolutions: viaEa ? EA_RESOLUTIONS : SUPPORTED_RESOLUTIONS,
        volume_precision: 0,
        data_status: "streaming",
        currency_code: sym.includes("JPY") ? "JPY" : "USD",
      };
      if (!sym) {
        onError("Unknown symbol");
        return;
      }
      setTimeout(() => onResolve(info), 0);
    },

    getBars: async (
      symbolInfo,
      resolution,
      periodParams: PeriodParams,
      onResult: HistoryCallback,
      _onError,
    ) => {
      const interval = resolutionToInterval(resolution);
      const { from, to, countBack } = periodParams;
      const barMs = barDurationMs(interval) || 60_000;
      const toMs = to * 1000;
      const ea = isEaTicker(symbolInfo.ticker);
      // EA bridge serves ≤500 bars per request; OANDA ~5000 per window.
      const maxBars = ea ? 500 : MAX_BARS_PER_REQUEST;
      // Clamp the window so a single request never exceeds the source's cap.
      // TV paginates for older data, so bounded windows still fill the chart.
      const fromMs = Math.max(from * 1000, toMs - maxBars * barMs);
      const ticker = symbolInfo.ticker ?? symbolInfo.name;
      // The newest window (to ≈ now) can be served from the warm client cache
      // seeded by prefetch — instant symbol/timeframe switches — then a normal
      // (non-fresh) network read refreshes it. Never sets fresh=1.
      const isLatestWindow = toMs >= Date.now() - barMs * 2;
      const cacheKey = klinesClientKey(stripEaPrefix(ticker), interval, market);
      if (isLatestWindow && !ea) {
        const cached = getKlinesClientCache(cacheKey);
        if (cached?.length) {
          const cachedBars: Bar[] = cached
            .filter((c) => Number.isFinite(c.time) && c.time > 0)
            .map((c) => ({
              time: c.time * 1000,
              open: c.open,
              high: c.high,
              low: c.low,
              close: c.close,
              volume: 0,
            }))
            .filter((b) => b.time <= toMs)
            .sort((a, b) => a.time - b.time);
          if (cachedBars.length) {
            onResult(cachedBars, { noData: false });
            // Background refresh keeps the cache warm without a fresh fetch.
            void fetchCandles(ticker, interval, {
              from: fromMs,
              to: toMs,
              limit: Math.min(Math.max(countBack, 300), maxBars),
              ea,
            })
              .then(({ candles }) => {
                if (candles.length) setKlinesClientCache(cacheKey, candles);
              })
              .catch(() => {});
            return;
          }
        }
      }
      const { candles: rows } = await fetchCandles(
        ticker,
        interval,
        {
          from: fromMs,
          to: toMs,
          limit: Math.min(Math.max(countBack, 300), maxBars),
          ea,
        },
      );
      if (isLatestWindow && !ea && rows.length) {
        setKlinesClientCache(cacheKey, rows);
      }
      const latest = rows[rows.length - 1];
      if (latest) {
        opts.onLatestCandle?.({
          symbol: stripEaPrefix(ticker).toUpperCase(),
          interval,
          time: latest.time * 1000,
          open: latest.open,
          high: latest.high,
          low: latest.low,
          close: latest.close,
          volume: latest.volume,
        });
      }
      // Retries exhausted or gap: return empty with noData:false (below) so TV
      // keeps the chart alive and re-requests naturally — never the error badge.
      const bars: Bar[] = rows
        .filter((c) => Number.isFinite(c.time) && c.time > 0)
        .map((c) => ({
          time: c.time * 1000, // seconds → ms for TradingView
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume ?? 0,
        }))
        // Keep everything up to `to`; the request was already bounded by fromMs.
        .filter((b) => b.time <= toMs)
        .sort((a, b) => a.time - b.time);
      // Unlimited history: an empty window is usually a market gap (weekend,
      // clamped range) — report noData:false so TV keeps paginating older
      // ranges as the user scrolls. Only stop at a hard age floor.
      // Empty window = market gap (weekend) → keep paginating older ranges.
      // Stop at a hard age floor (EA terminal history is shallower than OANDA).
      const floorMs =
        Date.now() - (ea ? 1 : 5) * 365 * 24 * 3600 * 1000;
      onResult(bars, {
        noData: bars.length === 0 && toMs < floorMs,
      });
    },

    subscribeBars: (
      symbolInfo,
      resolution,
      onTick: SubscribeBarsCallback,
      listenerGuid,
    ) => {
      const interval = resolutionToInterval(resolution);
      const ticker = symbolInfo.ticker ?? symbolInfo.name;
      const ea = isEaTicker(ticker);
      const poll = async () => {
        // Live forming candle: fresh=1 bypasses cache/warehouse staleness so the
        // last bar ticks in real time. Only the 2-bar tail is fetched fresh.
        const { candles: rows } = await fetchCandles(ticker, interval, {
          limit: 2,
          ea,
          fresh: true,
        });
        const last = rows[rows.length - 1];
        if (last && Number.isFinite(last.time)) {
          opts.onLatestCandle?.({
            symbol: stripEaPrefix(ticker).toUpperCase(),
            interval,
            time: last.time * 1000,
            open: last.open,
            high: last.high,
            low: last.low,
            close: last.close,
            volume: last.volume,
          });
          onTick({
            time: last.time * 1000,
            open: last.open,
            high: last.high,
            low: last.low,
            close: last.close,
            volume: last.volume ?? 0,
          });
        }
      };
      void poll();
      const timer = setInterval(() => void poll(), pollMsForResolution(resolution));
      subscribers.set(listenerGuid, timer);
    },

    unsubscribeBars: (listenerGuid) => {
      const timer = subscribers.get(listenerGuid);
      if (timer) {
        clearInterval(timer);
        subscribers.delete(listenerGuid);
      }
    },
  };
}
