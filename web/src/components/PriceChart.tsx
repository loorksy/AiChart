"use client";

import { useEffect, useRef, useState } from "react";
import {
  createChart,
  CandlestickSeries,
  LineSeries,
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
  pointsToLineData,
  styleForConfidence,
} from "@/lib/chartDrawings";
import type { Recommendation } from "@/lib/types";
import { cn } from "@/lib/utils";

interface Props {
  symbol: string;
  interval: string;
  recommendations: Recommendation[];
  overlays?: ChartOverlay[];
  drawings?: ChartDrawing[];
  /** Live last price — updates the current candle on each tick */
  livePrice?: number;
  className?: string;
  fill?: boolean;
  /** Muted decorative mode for page backgrounds */
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
  className,
  fill = false,
  ambient = false,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const lastBarTimeRef = useRef<number>(0);
  const [loading, setLoading] = useState(!ambient);
  const [error, setError] = useState<string | null>(null);

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
    let cancelled = false;
    const load = async () => {
      if (!ambient) {
        setLoading(true);
        setError(null);
      }
      try {
        const res = await fetch(
          `/api/market/klines?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&limit=${ambient ? 120 : 300}`,
        );
        const data = await res.json();
        if (cancelled) return;
        if (data.error) {
          if (!ambient) setError(data.error);
          return;
        }
        const series = seriesRef.current;
        if (!series) return;
        const candles = data.candles as CandlestickData<UTCTimestamp>[];
        series.setData(candles);
        const last = candles[candles.length - 1];
        if (last) lastBarTimeRef.current = Number(last.time);
        chartRef.current?.timeScale().fitContent();
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
  }, [symbol, interval, ambient]);

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

    const extraSeries: ISeriesApi<"Line">[] = [];
    const extraLines: ReturnType<ISeriesApi<"Candlestick">["createPriceLine"]>[] =
      [];
    const lastTime = lastBarTimeRef.current;

    for (const d of drawings ?? []) {
      const style = styleForConfidence(d.confidence, d.type);
      if (d.type === "price_line" && d.points[0]) {
        extraLines.push(
          candleSeries.createPriceLine({
            price: d.points[0].price,
            color: d.color ?? style.color,
            lineWidth: style.lineWidth,
            lineStyle: style.lineStyle,
            axisLabelVisible: true,
            title: d.label ?? "مستوى",
          }),
        );
      }
      if (
        (d.type === "forecast_path" ||
          d.type === "trend_line" ||
          d.type === "channel") &&
        d.points.length >= 2 &&
        lastTime > 0
      ) {
        const line = chart.addSeries(LineSeries, {
          color: d.color ?? style.color,
          lineWidth: style.lineWidth,
          lineStyle: style.lineStyle,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        });
        line.setData(
          pointsToLineData(d.points, lastTime, interval) as {
            time: UTCTimestamp;
            value: number;
          }[],
        );
        extraSeries.push(line);
      }
    }

    if ((drawings ?? []).some((d) => d.type === "forecast_path")) {
      chart.timeScale().applyOptions({ rightOffset: 12 });
    }

    return () => {
      for (const line of extraLines) candleSeries.removePriceLine(line);
      for (const s of extraSeries) chart.removeSeries(s);
    };
  }, [drawings, interval, ambient]);

  useEffect(() => {
    if (ambient) return;
    const series = seriesRef.current;
    if (!series) return;
    const relevant = recommendations
      .filter((r) => r.symbol === symbol.toUpperCase() && r.action !== "wait")
      .map<SeriesMarker<Time>>((r) => ({
        time: (Math.floor(new Date(r.created_at + "Z").getTime() / 1000) ||
          0) as UTCTimestamp,
        position: r.action === "buy" ? "belowBar" : "aboveBar",
        color: r.action === "buy" ? "#22c55e" : "#ef4444",
        shape: r.action === "buy" ? "arrowUp" : "arrowDown",
        text: `${r.action === "buy" ? "شراء" : "بيع"} ${r.confidence}%`,
      }))
      .sort((a, b) => Number(a.time) - Number(b.time));
    const markers = createSeriesMarkers(series, relevant);
    return () => markers.detach();
  }, [recommendations, symbol, ambient]);

  return (
    <div className={cn("relative w-full", fill && "h-full", className)}>
      <div
        ref={containerRef}
        className={cn("w-full", fill ? "h-full min-h-[200px]" : "h-[420px]")}
      />
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
