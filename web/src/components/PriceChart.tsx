"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  createChart,
  CandlestickSeries,
  createSeriesMarkers,
  ColorType,
  type IChartApi,
  type ISeriesApi,
  type CandlestickData,
  type UTCTimestamp,
  type SeriesMarker,
  type LogicalRange,
  type Time,
} from "lightweight-charts";
import type { ChartOverlay } from "@/lib/chartOverlays";
import { OVERLAY_COLORS, overlaysFromRecommendation } from "@/lib/chartOverlays";
import type { ChartDrawing } from "@/lib/chartDrawings";
import {
  parseChartDrawingsJson,
  validateChartDrawings,
} from "@/lib/chartDrawings";
import {
  applyChartDrawings,
  collectDrawingMarkers,
} from "@/lib/chartDrawingEngine";
import { profileForInterval } from "@/lib/analysisProfile";
import type { LegendItem } from "@/lib/chartDrawingLabels";
import { ChartDrawingLegend } from "@/components/market/ChartDrawingLegend";
import { ChartLivePriceBadge } from "@/components/market/ChartLivePriceBadge";
import type { LivePriceTick } from "@/hooks/useBinanceLivePrice";
import {
  useBinanceKlineStream,
  useThrottledLivePrice,
} from "@/hooks/useBinanceKlineStream";
import {
  getKlinesClientCache,
  klinesClientKey,
  setKlinesClientCache,
} from "@/lib/ohlc/klinesClientCache";
import {
  livePriceConsistent,
  sanitizeCandlesForMarket,
  type ChartMarket,
} from "@/lib/ohlc/chartTime";
import { intervalPlan } from "@/lib/intervals";
import type { Recommendation } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  validateChatImage,
  type ChatImagePayload,
} from "@/lib/chatImage";

interface Props {
  symbol: string;
  interval: string;
  recommendations: Recommendation[];
  overlays?: ChartOverlay[];
  drawings?: ChartDrawing[];
  livePrice?: number;
  liveTick?: LivePriceTick;
  market?: "crypto" | "forex";
  className?: string;
  fill?: boolean;
  ambient?: boolean;
  /** When > 0, re-fetch candles on this interval (ms) for a live preview. */
  refreshMs?: number;
}

export type PriceChartHandle = {
  capturePng: () => Promise<ChatImagePayload | null>;
};

const OVERLAY_LABELS: Record<ChartOverlay["type"], string> = {
  entry: "دخول",
  stop_loss: "وقف خسارة",
  take_profit: "هدف ربح",
  support: "دعم",
  resistance: "مقاومة",
};

function compositeCanvases(container: HTMLElement): string | null {
  const canvases = Array.from(container.querySelectorAll("canvas"));
  if (!canvases.length) return null;

  const width = container.clientWidth;
  const height = container.clientHeight;
  if (width <= 0 || height <= 0) return null;

  const composite = document.createElement("canvas");
  composite.width = width;
  composite.height = height;
  const ctx = composite.getContext("2d");
  if (!ctx) return null;

  ctx.fillStyle = "#0a0e17";
  ctx.fillRect(0, 0, width, height);

  for (const canvas of canvases) {
    ctx.drawImage(canvas, 0, 0, width, height);
  }

  const dataUrl = composite.toDataURL("image/png");
  const base64 = dataUrl.split(",")[1];
  return base64 ?? null;
}

const PriceChart = forwardRef<PriceChartHandle, Props>(function PriceChart(
  {
    symbol,
    interval,
    recommendations,
    overlays,
    drawings,
    livePrice,
    liveTick,
    market = "crypto",
    className,
    fill = false,
    ambient = false,
    refreshMs = 0,
  },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const [lastBarTime, setLastBarTime] = useState(0);
  const [loading, setLoading] = useState(!ambient);
  const [error, setError] = useState<string | null>(null);
  const [legendItems, setLegendItems] = useState<LegendItem[]>([]);
  const stableBarTimeRef = useRef(0);
  const loadingRef = useRef(loading);
  const errorRef = useRef(error);
  const initialLoadRef = useRef(true);
  const loadingHistoryRef = useRef(false);
  const candlesRef = useRef<CandlestickData<UTCTimestamp>[]>([]);

  // Derive overlays + drawings from the latest actionable recommendation for this
  // symbol. This makes a recommendation requested in chat (which has no explicit
  // `drawings`/`overlays` props) render its levels and zones on the chart exactly
  // like the analyze button does — for every pair and market. Explicit props from
  // the analyze flow always take precedence.
  const recLayers = useMemo(() => {
    const rec = [...recommendations]
      .reverse()
      .find(
        (r) =>
          r.symbol?.toUpperCase() === symbol.toUpperCase() &&
          (r.action === "buy" || r.action === "sell"),
      );
    if (!rec) {
      return { overlays: [] as ChartOverlay[], drawings: [] as ChartDrawing[] };
    }
    const raw = parseChartDrawingsJson(rec.chart_drawings_json);
    const validated = raw.length
      ? validateChartDrawings(
          raw,
          rec.action,
          rec.confidence ?? 60,
          profileForInterval(interval),
        )
      : [];
    return { overlays: overlaysFromRecommendation(rec), drawings: validated };
  }, [recommendations, symbol, interval]);

  const effectiveOverlays = overlays?.length ? overlays : recLayers.overlays;
  const effectiveDrawings = drawings?.length ? drawings : recLayers.drawings;
  const nextCursorRef = useRef<number | null>(null);
  const dataKey = `${symbol}|${interval}|${market}`;
  const chartLimit = ambient ? 120 : 500;

  const klineNative = market === "crypto" && intervalPlan(interval).factor === 1;
  const liveKline = useBinanceKlineStream(symbol, interval, klineNative && !ambient);
  const throttledLivePrice = useThrottledLivePrice(
    klineNative ? undefined : livePrice,
    100,
  );

  useEffect(() => {
    initialLoadRef.current = true;
    candlesRef.current = [];
    const series = seriesRef.current;
    if (series && !ambient) {
      series.setData([]);
    }
    setLastBarTime(0);
    stableBarTimeRef.current = 0;
    if (!ambient) setError(null);
    nextCursorRef.current = null;
  }, [dataKey, ambient]);

  useEffect(() => {
    loadingRef.current = loading;
  }, [loading]);

  useEffect(() => {
    errorRef.current = error;
  }, [error]);

  useImperativeHandle(ref, () => ({
    async capturePng(): Promise<ChatImagePayload | null> {
      if (ambient || loadingRef.current || errorRef.current) return null;
      const container = containerRef.current;
      if (!container) return null;

      const base64 = compositeCanvases(container);
      if (!base64) return null;

      const validated = validateChatImage("image/png", base64);
      return validated.ok ? validated.image : null;
    },
  }));

  function parseRecTime(createdAt: string): number {
    const normalized = createdAt.includes("T")
      ? createdAt
      : `${createdAt.replace(" ", "T")}Z`;
    const ms = Date.parse(normalized);
    return Number.isFinite(ms) ? Math.floor(ms / 1000) : 0;
  }

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const chart = createChart(el, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: ambient ? "transparent" : "#9ca3af",
        attributionLogo: false,
      },
      grid: {
        vertLines: { visible: !ambient, color: "rgba(255,255,255,0.04)" },
        horzLines: { visible: !ambient, color: "rgba(255,255,255,0.04)" },
      },
      rightPriceScale: {
        visible: !ambient,
        borderVisible: false,
        borderColor: "rgba(255,255,255,0.08)",
      },
      timeScale: {
        visible: !ambient,
        borderVisible: false,
        borderColor: "rgba(255,255,255,0.08)",
        timeVisible: !ambient,
      },
      crosshair: {
        mode: 0,
        vertLine: { visible: !ambient },
        horzLine: { visible: !ambient },
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: false,
      },
      handleScale: {
        axisPressedMouseMove: true,
        mouseWheel: true,
        pinch: true,
      },
      autoSize: true,
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor: ambient ? "rgba(34, 197, 94, 0.45)" : "#22c55e",
      downColor: ambient ? "rgba(239, 68, 68, 0.45)" : "#ef4444",
      borderVisible: false,
      wickUpColor: ambient ? "rgba(34, 197, 94, 0.3)" : "#22c55e",
      wickDownColor: ambient ? "rgba(239, 68, 68, 0.3)" : "#ef4444",
    });

    chartRef.current = chart;
    seriesRef.current = series;

    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [ambient]);

  useEffect(() => {
    const el = containerRef.current;
    const chart = chartRef.current;
    if (!el || !chart || ambient) return;

    const ro = new ResizeObserver(() => {
      chart.resize(el.clientWidth, el.clientHeight);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ambient]);

  useEffect(() => {
    let cancelled = false;
    const cacheKey = klinesClientKey(symbol, interval, market);
    let hadCache = false;

    const applyCandles = (
      raw: CandlestickData<UTCTimestamp>[],
      opts: { fit?: boolean; merge?: "replace" | "prepend" } = {},
    ) => {
      const series = seriesRef.current;
      if (!series || raw.length === 0) return false;

      const sanitized = sanitizeCandlesForMarket(
        raw,
        market as ChartMarket,
      ) as CandlestickData<UTCTimestamp>[];
      if (sanitized.length === 0) return false;

      let merged = sanitized;
      if (opts.merge === "prepend" && candlesRef.current.length > 0) {
        const byTime = new Map<number, CandlestickData<UTCTimestamp>>();
        for (const c of [...sanitized, ...candlesRef.current]) {
          byTime.set(Number(c.time), c);
        }
        merged = Array.from(byTime.values()).sort(
          (a, b) => Number(a.time) - Number(b.time),
        );
      }

      candlesRef.current = merged;
      series.setData(merged);
      setKlinesClientCache(cacheKey, merged);

      const last = merged[merged.length - 1];
      if (last) {
        const t = Number(last.time);
        setLastBarTime(t);
        stableBarTimeRef.current = t;
      }
      if (opts.fit) {
        chartRef.current?.timeScale().fitContent();
      } else if (!opts.merge && merged.length > 0) {
        chartRef.current?.timeScale().scrollToRealTime();
      }
      return true;
    };

    if (!ambient) {
      const cached = getKlinesClientCache(cacheKey);
      const series = seriesRef.current;
      if (cached?.length && series) {
        if (applyCandles(cached as CandlestickData<UTCTimestamp>[])) {
          setLoading(false);
          hadCache = true;
          initialLoadRef.current = false;
        }
      }
    }

    const load = async (silent = false, fast = false) => {
      const showSpinner = !ambient && !silent && initialLoadRef.current && !hadCache;
      if (showSpinner) {
        setLoading(true);
        setError(null);
      }
      try {
        const freshQ = silent ? "&fresh=1" : "";
        const fastQ = fast ? "&fast=1" : "";
        const res = await fetch(
          `/api/market/klines?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&market=${market}&limit=${chartLimit}${freshQ}${fastQ}`,
        );
        const data = await res.json();
        if (cancelled) return;
        if (data.error && !data.candles?.length) {
          if (!ambient && !hadCache && !silent) setError(data.error);
          return;
        }
        const candles = (data.candles ?? []) as CandlestickData<UTCTimestamp>[];
        if (candles.length > 0) {
          const applied = applyCandles(candles, {
            fit: !silent && initialLoadRef.current,
          });
          if (!applied && !ambient && !silent) {
            setError("بيانات الشارت غير متوافقة مع الرمز");
          }
          nextCursorRef.current =
            typeof data.nextCursor === "number" ? data.nextCursor : null;
        }
        initialLoadRef.current = false;
        if (!ambient && candles.length === 0 && data.pending) {
          setError(
            market === "forex"
              ? "بانتظار بيانات MetaTrader — ربط EA من الإعدادات → التكاملات"
              : "لا توجد بيانات شارت لهذا الرمز.",
          );
        } else if (!ambient && candles.length > 0) {
          setError(null);
        }
      } catch {
        if (!cancelled && !ambient && !silent && !hadCache) {
          setError("تعذّر تحميل بيانات الشارت.");
        }
      } finally {
        if (!cancelled && showSpinner) setLoading(false);
      }
    };

    void (async () => {
      if (!hadCache && !ambient) {
        // Forex EA cache can lag on 1m — skip fast stale path.
        if (market !== "forex") {
          await load(false, true);
        }
      }
      await load(hadCache, false);
    })();

    const poll =
      !ambient && refreshMs > 0
        ? setInterval(() => void load(true), refreshMs)
        : null;
    return () => {
      cancelled = true;
      if (poll) clearInterval(poll);
    };
  }, [symbol, interval, ambient, market, refreshMs, chartLimit]);

  useEffect(() => {
    if (ambient || market !== "crypto") return;
    const chart = chartRef.current;
    if (!chart) return;

    const onRange = (range: LogicalRange | null) => {
      if (!range || loadingHistoryRef.current) return;
      if (range.from > 12) return;
      const cursor = nextCursorRef.current;
      if (!cursor) return;

      loadingHistoryRef.current = true;
      void (async () => {
        try {
          const res = await fetch(
            `/api/market/klines?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&market=${market}&limit=200&cursor=${cursor}`,
          );
          const data = await res.json();
          const older = (data.candles ?? []) as CandlestickData<UTCTimestamp>[];
          if (older.length === 0) {
            nextCursorRef.current = null;
            return;
          }
          const series = seriesRef.current;
          if (!series) return;

          const sanitized = sanitizeCandlesForMarket(
            older,
            market as ChartMarket,
          ) as CandlestickData<UTCTimestamp>[];
          if (sanitized.length === 0) return;

          const byTime = new Map<number, CandlestickData<UTCTimestamp>>();
          for (const c of [...sanitized, ...candlesRef.current]) {
            byTime.set(Number(c.time), c);
          }
          const merged = Array.from(byTime.values()).sort(
            (a, b) => Number(a.time) - Number(b.time),
          );
          candlesRef.current = merged;
          series.setData(merged);
          setKlinesClientCache(
            klinesClientKey(symbol, interval, market),
            merged,
          );
          nextCursorRef.current =
            typeof data.nextCursor === "number" ? data.nextCursor : null;
        } finally {
          loadingHistoryRef.current = false;
        }
      })();
    };

    chart.timeScale().subscribeVisibleLogicalRangeChange(onRange);
    return () => chart.timeScale().unsubscribeVisibleLogicalRangeChange(onRange);
  }, [symbol, interval, market, ambient]);

  useEffect(() => {
    if (ambient || !liveKline) return;
    const series = seriesRef.current;
    if (!series) return;
    const data = series.data();
    if (data.length > 0) {
      const last = data[data.length - 1];
      if ("close" in last && Number(last.time) !== liveKline.time) {
        if (
          !livePriceConsistent(
            last.close,
            liveKline.close,
            market as ChartMarket,
          )
        ) {
          return;
        }
      }
    }
    series.update({
      time: liveKline.time as UTCTimestamp,
      open: liveKline.open,
      high: liveKline.high,
      low: liveKline.low,
      close: liveKline.close,
    });
    if (liveKline.closed) {
      setLastBarTime(liveKline.time);
      stableBarTimeRef.current = liveKline.time;
    }
  }, [liveKline, ambient, market]);

  useEffect(() => {
    if (ambient || klineNative || !throttledLivePrice || throttledLivePrice <= 0) return;
    const series = seriesRef.current;
    if (!series) return;
    const data = series.data();
    if (data.length === 0) return;
    const last = data[data.length - 1];
    if (!("close" in last)) return;
    if (
      !livePriceConsistent(
        last.close,
        throttledLivePrice,
        market as ChartMarket,
      )
    ) {
      return;
    }
    if (market === "forex") {
      series.update({ ...last, close: throttledLivePrice });
    } else {
      series.update({
        ...last,
        close: throttledLivePrice,
        high: Math.max(last.high, throttledLivePrice),
        low: Math.min(last.low, throttledLivePrice),
      });
    }
  }, [throttledLivePrice, ambient, klineNative, market]);

  useEffect(() => {
    if (ambient) return;
    const series = seriesRef.current;
    if (!series) return;
    const priceLines = effectiveOverlays.map((o) =>
      series.createPriceLine({
        price: o.price,
        color: OVERLAY_COLORS[o.type],
        lineWidth: 2,
        lineStyle: o.type === "support" || o.type === "resistance" ? 2 : 0,
        axisLabelVisible: true,
        title: o.label ?? OVERLAY_LABELS[o.type],
      }),
    );
    return () => {
      for (const line of priceLines) series.removePriceLine(line);
    };
  }, [effectiveOverlays, ambient]);

  useEffect(() => {
    if (ambient) return;
    const chart = chartRef.current;
    const candleSeries = seriesRef.current;
    if (!chart || !candleSeries) return;

    const result = applyChartDrawings(
      chart,
      candleSeries,
      effectiveDrawings,
      stableBarTimeRef.current || lastBarTime,
      interval,
    );
    setLegendItems(result.legendItems);

    return () => {
      result.cleanup();
      setLegendItems([]);
    };
  }, [effectiveDrawings, interval, lastBarTime, ambient]);

  useEffect(() => {
    if (ambient) return;
    const series = seriesRef.current;
    if (!series) return;

    const recMarkers = recommendations
      .filter((r) => r.symbol === symbol.toUpperCase() && r.action !== "wait")
      .map<SeriesMarker<Time>>((r) => ({
        time: parseRecTime(r.created_at) as UTCTimestamp,
        position: r.action === "buy" ? "belowBar" : "aboveBar",
        color: r.action === "buy" ? "#22c55e" : "#ef4444",
        shape: r.action === "buy" ? "arrowUp" : "arrowDown",
        text: `${r.action === "buy" ? "شراء" : "بيع"} ${r.confidence}%`,
      }));

    const drawingMarkers =
      lastBarTime > 0
        ? collectDrawingMarkers(effectiveDrawings, lastBarTime, interval)
        : [];

    const merged = [...recMarkers, ...drawingMarkers].sort(
      (a, b) => Number(a.time) - Number(b.time),
    );
    const markers = createSeriesMarkers(series, merged);
    return () => markers.detach();
  }, [recommendations, symbol, effectiveDrawings, interval, lastBarTime, ambient]);

  return (
    <div className={cn("relative isolate z-0 w-full", fill && "h-full", className)}>
      <div
        ref={containerRef}
        className={cn("relative z-0 w-full", fill ? "h-full min-h-[200px]" : "h-[420px]")}
      />
      {!ambient && liveTick && (
        <ChartLivePriceBadge
          symbol={symbol}
          live={liveTick}
          className="lg:hidden"
        />
      )}
      {!ambient && legendItems.length > 0 && (
        <ChartDrawingLegend items={legendItems} />
      )}
      {!ambient && loading && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
          جارٍ تحميل الشارت…
        </div>
      )}
      {!ambient && error && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-destructive">
          {error}
        </div>
      )}
    </div>
  );
});

export default PriceChart;
