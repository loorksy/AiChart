"use client";

import { useEffect, useRef, useState } from "react";
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
  type Time,
} from "lightweight-charts";
import type { ChartOverlay } from "@/lib/chartOverlays";
import { OVERLAY_COLORS } from "@/lib/chartOverlays";
import type { ChartDrawing } from "@/lib/chartDrawings";
import {
  applyChartDrawings,
  collectDrawingMarkers,
} from "@/lib/chartDrawingEngine";
import type { LegendItem } from "@/lib/chartDrawingLabels";
import { ChartDrawingLegend } from "@/components/market/ChartDrawingLegend";
import { ChartLivePriceBadge } from "@/components/market/ChartLivePriceBadge";
import type { LivePriceTick } from "@/hooks/useBinanceLivePrice";
import type { Recommendation } from "@/lib/types";
import { cn } from "@/lib/utils";

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
}

const OVERLAY_LABELS: Record<ChartOverlay["type"], string> = {
  entry: "دخول",
  stop_loss: "وقف خسارة",
  take_profit: "هدف ربح",
  support: "دعم",
  resistance: "مقاومة",
};

export default function PriceChart({
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
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const [lastBarTime, setLastBarTime] = useState(0);
  const [loading, setLoading] = useState(!ambient);
  const [error, setError] = useState<string | null>(null);
  const [legendItems, setLegendItems] = useState<LegendItem[]>([]);
  const stableBarTimeRef = useRef(0);

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
      chart.timeScale().fitContent();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ambient]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!ambient) {
        setLoading(true);
        setError(null);
      }
      try {
        const res = await fetch(
          `/api/market/klines?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&market=${market}&limit=${ambient ? 120 : 300}`,
        );
        const data = await res.json();
        if (cancelled) return;
        if (data.error) {
          if (!ambient) setError(data.error);
          return;
        }
        const series = seriesRef.current;
        if (!series) return;
        const candles = (data.candles ?? []) as CandlestickData<UTCTimestamp>[];
        series.setData(candles);
        const last = candles[candles.length - 1];
        if (last) {
          const t = Number(last.time);
          setLastBarTime(t);
          stableBarTimeRef.current = t;
        }
        chartRef.current?.timeScale().fitContent();
        if (!ambient && candles.length === 0 && data.pending) {
          setError(
            market === "forex"
              ? "بانتظار بيانات MetaTrader — ربط EA من الإعدادات → التكاملات"
              : "لا توجد بيانات شارت لهذا الرمز.",
          );
        }
      } catch {
        if (!cancelled && !ambient) setError("تعذّر تحميل بيانات الشارت.");
      } finally {
        if (!cancelled && !ambient) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [symbol, interval, ambient, market]);

  useEffect(() => {
    if (ambient || !livePrice || livePrice <= 0) return;
    const series = seriesRef.current;
    if (!series) return;
    const data = series.data();
    if (data.length === 0) return;
    const last = data[data.length - 1];
    if (!("close" in last)) return;
    series.update({
      ...last,
      close: livePrice,
      high: Math.max(last.high, livePrice),
      low: Math.min(last.low, livePrice),
    });
  }, [livePrice, ambient]);

  useEffect(() => {
    if (ambient) return;
    const series = seriesRef.current;
    if (!series) return;
    const priceLines = (overlays ?? []).map((o) =>
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
  }, [overlays, ambient]);

  useEffect(() => {
    if (ambient) return;
    const chart = chartRef.current;
    const candleSeries = seriesRef.current;
    if (!chart || !candleSeries) return;

    const result = applyChartDrawings(
      chart,
      candleSeries,
      drawings ?? [],
      stableBarTimeRef.current || lastBarTime,
      interval,
    );
    setLegendItems(result.legendItems);

    return () => {
      result.cleanup();
      setLegendItems([]);
    };
  }, [drawings, interval, lastBarTime, ambient]);

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
        ? collectDrawingMarkers(drawings ?? [], lastBarTime, interval)
        : [];

    const merged = [...recMarkers, ...drawingMarkers].sort(
      (a, b) => Number(a.time) - Number(b.time),
    );
    const markers = createSeriesMarkers(series, merged);
    return () => markers.detach();
  }, [recommendations, symbol, drawings, interval, lastBarTime, ambient]);

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
}
