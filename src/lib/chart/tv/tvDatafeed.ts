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
  dropKlinesClientCache,
  getKlinesClientCache,
  setKlinesClientCache,
  klinesClientKey,
} from "@/lib/ohlc/klinesClientCache";
import { APP_WAKE_EVENT, tickReconnectDelayMs } from "@/lib/appWake";
import { fetchWithTimeout } from "@/lib/fetchWithTimeout";
import { SYMBOL_MINMOV, symbolPriceScale } from "@/lib/chart/tv/tvSymbolTicks";

/** No PRICE/tick for this long → treat the SSE as a zombie and poll again. */
export const TICK_STALE_MS = 12_000;

/**
 * No SSE message AT ALL — including server heartbeats (every 15s) — for this
 * long while visible → the socket is dead, whatever readyState claims.
 * Mobile Chrome kills background EventSources without firing onerror, and a
 * readyState of OPEN on such a corpse is a lie. Two missed heartbeats plus
 * margin: a healthy stream can never go this quiet.
 */
export const SSE_SILENT_MS = 40_000;

/**
 * No bar emitted for this long when the tab comes back → the widget's own bar
 * cache is missing candles (background tabs freeze the timers AND the SSE), so
 * history must be re-requested, not just the forming bar re-polled. Re-polling
 * alone painted the newest candle next to a hole the chart never repaired.
 */
export const BACKFILL_AFTER_MS = 30_000;

/**
 * May this bar be handed to TradingView's realtime callback?
 *
 * TV refuses a bar older than the last one it was given — a "time violation"
 * that poisons the subscription: every later update is ignored and the chart
 * sits frozen until a full page reload. The losing order happens exactly at
 * wake/rollover, when the fresh-candle poll races the reconnected tick stream
 * and resolves with the PREVIOUS bar after a tick already opened the next one.
 * Equal time is an update of the current bar and is always allowed.
 */
export function barEmittable(
  lastBarTimeMs: number | undefined,
  nextBarTimeMs: number,
): boolean {
  if (!Number.isFinite(nextBarTimeMs)) return false;
  if (lastBarTimeMs == null || !Number.isFinite(lastBarTimeMs)) return true;
  return nextBarTimeMs >= lastBarTimeMs;
}

import { CHART_CAPTURE_CANDLES } from "@/lib/chart/captureWindow";

/** Upstream history pulls reject ranges over ~5000 candles — stay safely under. */
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
  fresh?: boolean;
}): string {
  const search = new URLSearchParams({
    symbol: params.symbol,
    interval: params.interval,
    market: params.market ?? "forex",
  });
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

// minmov/pricescale live in tvSymbolTicks — the drawing adapter converts the
// position tool's profit/stop distances to ticks with the SAME numbers this
// datafeed reports, so the library reconstructs the exact prices.

/** Bars served by the platform OANDA feed. */
const CLOUD_EXCHANGE = "OANDA";

type BarSubscription = {
  timer?: ReturnType<typeof setInterval>;
  staleTimer?: ReturnType<typeof setInterval>;
  source?: EventSource;
  reconnectTimer?: ReturnType<typeof setTimeout>;
  onVisibility?: () => void;
  onWake?: () => void;
};

/** Datafeed backed by AiChart's own /api/market/klines + /api/instruments. */
export function createAiChartDatafeed(
  market: MarketType = "forex",
  opts: {
    onLatestCandle?: (candle: TvLatestCandle) => void;
    /**
     * The tab was away long enough that candles are MISSING, not merely the
     * forming bar stale. The datafeed has already told TV to drop its bar
     * cache; the widget owner must now call `resetData()` so history is
     * re-requested and the hole backfills without a manual reload.
     */
    onBarsStale?: () => void;
  } = {},
): IBasicDataFeed {
  // Every bar is served by the platform OANDA feed.
  const exchange = CLOUD_EXCHANGE;
  const symbolType = "forex";
  const subscribers = new Map<string, BarSubscription>();

  const config: DatafeedConfiguration = {
    supported_resolutions: SUPPORTED_RESOLUTIONS,
    exchanges: [{ value: exchange, name: exchange, desc: exchange }],
    symbols_types: [{ name: symbolType, value: symbolType }],
  };

  async function fetchCandles(
    symbol: string,
    interval: string,
    opts2: {
      from?: number;
      to?: number;
      limit?: number;
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
      fresh: opts.fresh,
    });
    // Transient upstream blips (broker rate-limit under burst load) are retried
    // HERE, silently — surfacing onError would flash TV's "network error"
    // badge for a one-off hiccup.
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await fetchWithTimeout(url, {
          cache: "no-store",
          timeoutMs: 8_000,
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
      const wantExchange = !exchangeFilter || exchangeFilter === exchange;
      const items: SearchSymbolResultItem[] = [];

      if (wantExchange) {
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
      }

      onResult(items);
    },

    resolveSymbol: (symbolName, onResolve: ResolveCallback, onError) => {
      const bare = symbolName.includes(":")
        ? symbolName.split(":").pop()!
        : symbolName;
      /*
       * Case is only folded for canonical chart keys. A broker symbol arrives
       * already spelled the way its catalogue spells it — XAUUSDm, AAPLm —
       * and uppercasing it here is what reached the feed as a symbol that does
       * not exist. A lowercase letter is the tell: canonical keys never carry
       * one.
       */
      const sym = /[a-z]/.test(bare) ? bare : bare.toUpperCase();
      const exch = exchange;
      const info: LibrarySymbolInfo = {
        name: sym,
        ticker: sym,
        description: sym,
        type: symbolType,
        session: "24x7",
        exchange: exch,
        listed_exchange: exch,
        timezone: "Etc/UTC",
        format: "price",
        minmov: SYMBOL_MINMOV,
        pricescale: symbolPriceScale(sym),
        has_intraday: true,
        has_weekly_and_monthly: true,
        // Every resolution is served NATIVELY by our klines API. Without these,
        // TV assumes only 1-minute data exists and requests 1m for a 15m chart
        // (weeks of 1m bars → clamped window → "empty" higher timeframes).
        intraday_multipliers: ["1", "3", "5", "15", "30", "60", "120", "240"],
        daily_multipliers: ["1"],
        weekly_multipliers: ["1"],
        monthly_multipliers: ["1"],
        supported_resolutions: SUPPORTED_RESOLUTIONS,
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
      const maxBars = MAX_BARS_PER_REQUEST;
      // Clamp the window so a single request never exceeds the source's cap.
      // TV paginates for older data, so bounded windows still fill the chart.
      const fromMs = Math.max(from * 1000, toMs - maxBars * barMs);
      const ticker = symbolInfo.ticker ?? symbolInfo.name;
      // The newest window (to ≈ now) can be served from the warm client cache
      // seeded by prefetch — instant symbol/timeframe switches — then a normal
      // (non-fresh) network read refreshes it. Never sets fresh=1.
      const isLatestWindow = toMs >= Date.now() - barMs * 2;
      const cacheKey = klinesClientKey(ticker, interval, market);
      if (isLatestWindow) {
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
              limit: Math.min(Math.max(countBack, CHART_CAPTURE_CANDLES), maxBars),
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
          limit: Math.min(Math.max(countBack, CHART_CAPTURE_CANDLES), maxBars),
        },
      );
      if (isLatestWindow && rows.length) {
        setKlinesClientCache(cacheKey, rows);
      }
      const latest = rows[rows.length - 1];
      if (latest) {
        opts.onLatestCandle?.({
          symbol: ticker.toUpperCase(),
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
      const floorMs = Date.now() - 5 * 365 * 24 * 3600 * 1000;
      onResult(bars, {
        noData: bars.length === 0 && toMs < floorMs,
      });
    },

    subscribeBars: (
      symbolInfo,
      resolution,
      onTick: SubscribeBarsCallback,
      listenerGuid,
      onResetCacheNeeded?: () => void,
    ) => {
      const interval = resolutionToInterval(resolution);
      const ticker = symbolInfo.ticker ?? symbolInfo.name;
      const barMs = barDurationMs(interval) || 60_000;
      let forming: Bar | null = null;
      let streamAlive = false;
      let lastTickAt = 0;
      let lastEmitAt = 0;
      // Anchors the backfill decision when the tab was backgrounded BEFORE the
      // first bar ever emitted — lastEmitAt alone stays 0 in that case and the
      // wake path used to skip the history re-request entirely.
      const subscribedAt = Date.now();
      // Any SSE message counts — ready, heartbeat, tick. The silence watchdog
      // compares against this, so a quiet market with live heartbeats is NOT
      // mistaken for a dead socket, and a dead socket can no longer hide
      // behind a stale readyState.
      let lastMessageAt = 0;

      const emit = (bar: Bar) => {
        forming = bar;
        lastEmitAt = Date.now();
        opts.onLatestCandle?.({
          symbol: ticker,
          interval,
          time: bar.time,
          open: bar.open,
          high: bar.high,
          low: bar.low,
          close: bar.close,
          volume: bar.volume,
        });
        onTick(bar);
      };

      const poll = async () => {
        // Fallback / bootstrap: fresh=1 bypasses cache so the forming bar is
        // current. A "ready" SSE with no ticks is a zombie — still poll.
        const stale = lastTickAt === 0 || Date.now() - lastTickAt > TICK_STALE_MS;
        if (streamAlive && !stale) return;
        const { candles: rows } = await fetchCandles(ticker, interval, {
          limit: 2,
          fresh: true,
        });
        const last = rows[rows.length - 1];
        if (
          last &&
          Number.isFinite(last.time) &&
          // A poll resolving AFTER a live tick opened the next bar must be
          // dropped, not emitted: TV treats a backwards bar time as a
          // violation and stops accepting updates — the frozen chart that
          // only a reload used to fix.
          barEmittable(forming?.time, last.time * 1000)
        ) {
          emit({
            time: last.time * 1000,
            open: last.open,
            high: last.high,
            low: last.low,
            close: last.close,
            volume: last.volume ?? 0,
          });
        }
      };

      const applyTickPrice = (price: number, timeMs: number) => {
        const openTime = Math.floor(timeMs / barMs) * barMs;
        // Same monotonic rule as poll: a tick carrying a lagging server clock
        // must not step the series backwards.
        if (!barEmittable(forming?.time, openTime)) return;
        if (!forming || forming.time !== openTime) {
          emit({
            time: openTime,
            open: price,
            high: price,
            low: price,
            close: price,
            volume: 0,
          });
          return;
        }
        emit({
          time: openTime,
          open: forming.open,
          high: Math.max(forming.high, price),
          low: Math.min(forming.low, price),
          close: price,
          volume: forming.volume ?? 0,
        });
      };

      void poll();
      const timer = setInterval(() => void poll(), pollMsForResolution(resolution));
      const sub: BarSubscription = { timer };

      // Live ticks via SSE. A dropped socket used to stay closed for the
      // rest of the visible session — the chart looked frozen even though
      // open/close still worked. Reopen with backoff; poll covers the gap.
      if (typeof EventSource !== "undefined") {
        let reconnectAttempt = 0;

        const clearReconnect = () => {
          if (sub.reconnectTimer) {
            clearTimeout(sub.reconnectTimer);
            sub.reconnectTimer = undefined;
          }
        };

        const bindSource = (source: EventSource) => {
          sub.source = source;
          lastMessageAt = Date.now();
          source.onmessage = (event) => {
            try {
              const data = JSON.parse(event.data) as {
                type?: string;
                mid?: number;
                time?: number;
              };
              lastMessageAt = Date.now();
              if (data.type === "ready" || data.type === "heartbeat") {
                streamAlive = true;
                reconnectAttempt = 0;
                return;
              }
              if (data.type !== "tick") return;
              const mid = Number(data.mid);
              const time = Number(data.time) || Date.now();
              if (!Number.isFinite(mid)) return;
              streamAlive = true;
              reconnectAttempt = 0;
              lastTickAt = Date.now();
              applyTickPrice(mid, time);
            } catch {
              /* malformed frame — keep listening */
            }
          };
          source.onerror = () => {
            streamAlive = false;
            source.close();
            if (sub.source === source) sub.source = undefined;
            scheduleReconnect();
          };
        };

        const openStream = (force = false) => {
          if (typeof document !== "undefined" && document.visibilityState === "hidden") {
            return;
          }
          if (
            !force &&
            sub.source &&
            sub.source.readyState !== EventSource.CLOSED
          ) {
            return;
          }
          sub.source?.close();
          sub.source = undefined;
          bindSource(
            new EventSource(`/api/market/ticks?symbol=${encodeURIComponent(ticker)}`),
          );
        };

        const scheduleReconnect = () => {
          if (typeof document !== "undefined" && document.visibilityState === "hidden") {
            return;
          }
          if (sub.reconnectTimer) return;
          const delay = tickReconnectDelayMs(reconnectAttempt);
          reconnectAttempt += 1;
          sub.reconnectTimer = setTimeout(() => {
            sub.reconnectTimer = undefined;
            openStream();
          }, delay);
        };

        // Resume events arrive in bursts (visibilitychange + focus + pageshow
        // + app-wake within the same second); one full rebuild serves them all.
        let lastWakeHandledAt = 0;

        const onVisibility = () => {
          if (document.visibilityState === "hidden") {
            streamAlive = false;
            clearReconnect();
            sub.source?.close();
            sub.source = undefined;
            return;
          }
          const now = Date.now();
          if (now - lastWakeHandledAt < 1_000) return;
          lastWakeHandledAt = now;
          // Away long enough that whole candles are missing (frozen timers,
          // dead SSE, bfcache restore, server-link recovery)? Re-polling only
          // repaints the NEWEST bar next to a hole. Tell TV to drop its bar
          // cache and ask the widget owner to resetData() so history is
          // re-requested and the gap backfills without a manual reload.
          // Never emitted yet? Judge against subscription time instead —
          // a chart backgrounded before its first bar still needs the truth.
          const missedBars =
            now - (lastEmitAt > 0 ? lastEmitAt : subscribedAt) > BACKFILL_AFTER_MS;
          reconnectAttempt = 0;
          clearReconnect();
          streamAlive = false;
          // Teardown + rebuild unconditionally — a background-killed
          // EventSource can still claim readyState OPEN.
          openStream(true);
          if (missedBars) {
            // The forming-bar anchor belongs to the stale pre-sleep period;
            // fresh emits must not be judged against it.
            forming = null;
            // Bars cached before the sleep ARE the hole — resetData() must
            // not be answered from them, or the chart repaints its own gap.
            dropKlinesClientCache(klinesClientKey(ticker, interval, market));
            try {
              onResetCacheNeeded?.();
            } catch {
              /* TV may be mid-teardown */
            }
            opts.onBarsStale?.();
          }
          void poll();
        };

        // Staleness watchdog. Message silence — no tick, no heartbeat, no
        // ready — is the one reliable death signal now that the server
        // heartbeats every 15s: readyState lies after mobile Chrome kills a
        // background socket, and tick gaps alone are normal in a quiet
        // market. Also self-heals a subscription left with neither a socket
        // nor a pending reconnect (e.g. reconnect was skipped while hidden).
        sub.staleTimer = setInterval(() => {
          if (typeof document !== "undefined" && document.visibilityState === "hidden") {
            return;
          }
          if (!sub.source) {
            if (!sub.reconnectTimer) openStream(true);
            return;
          }
          if (lastMessageAt > 0 && Date.now() - lastMessageAt > SSE_SILENT_MS) {
            streamAlive = false;
            openStream(true);
            void poll();
          }
        }, 4_000);

        openStream();
        document.addEventListener("visibilitychange", onVisibility);
        window.addEventListener(APP_WAKE_EVENT, onVisibility);
        window.addEventListener("online", onVisibility);
        sub.onVisibility = onVisibility;
        sub.onWake = onVisibility;
      }

      subscribers.set(listenerGuid, sub);
    },

    unsubscribeBars: (listenerGuid) => {
      const sub = subscribers.get(listenerGuid);
      if (!sub) return;
      if (sub.timer) clearInterval(sub.timer);
      if (sub.staleTimer) clearInterval(sub.staleTimer);
      if (sub.reconnectTimer) clearTimeout(sub.reconnectTimer);
      sub.source?.close();
      if (sub.onVisibility) {
        document.removeEventListener("visibilitychange", sub.onVisibility);
        window.removeEventListener(APP_WAKE_EVENT, sub.onVisibility);
        window.removeEventListener("online", sub.onVisibility);
      }
      subscribers.delete(listenerGuid);
    },
  };
}
