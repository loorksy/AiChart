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
import type { Recommendation } from "@/lib/types";

interface Props {
  symbol: string;
  interval: string;
  recommendations: Recommendation[];
}

export default function PriceChart({ symbol, interval, recommendations }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Create the chart once.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const chart = createChart(el, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#8b9bb4",
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: "rgba(36,48,73,0.4)" },
        horzLines: { color: "rgba(36,48,73,0.4)" },
      },
      rightPriceScale: { borderColor: "#243049" },
      timeScale: { borderColor: "#243049", timeVisible: true },
      crosshair: { mode: 0 },
      autoSize: true,
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#16c784",
      downColor: "#f6465d",
      borderVisible: false,
      wickUpColor: "#16c784",
      wickDownColor: "#f6465d",
    });
    chartRef.current = chart;
    seriesRef.current = series;

    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  // Load candles when symbol/interval change.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/market/klines?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&limit=300`,
        );
        const data = await res.json();
        if (cancelled) return;
        if (data.error) {
          setError(data.error);
          return;
        }
        const series = seriesRef.current;
        if (!series) return;
        series.setData(data.candles as CandlestickData<UTCTimestamp>[]);
        chartRef.current?.timeScale().fitContent();
      } catch {
        if (!cancelled) setError("تعذّر تحميل بيانات الشارت.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [symbol, interval]);

  // Overlay recommendation markers for this symbol.
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    const relevant = recommendations
      .filter((r) => r.symbol === symbol.toUpperCase() && r.action !== "wait")
      .map<SeriesMarker<Time>>((r) => ({
        time: (Math.floor(new Date(r.created_at + "Z").getTime() / 1000) ||
          0) as UTCTimestamp,
        position: r.action === "buy" ? "belowBar" : "aboveBar",
        color: r.action === "buy" ? "#16c784" : "#f6465d",
        shape: r.action === "buy" ? "arrowUp" : "arrowDown",
        text: `${r.action === "buy" ? "شراء" : "بيع"} ${r.confidence}%`,
      }))
      .sort((a, b) => Number(a.time) - Number(b.time));
    const markers = createSeriesMarkers(series, relevant);
    return () => markers.detach();
  }, [recommendations, symbol]);

  return (
    <div className="relative w-full">
      <div ref={containerRef} className="h-[420px] w-full" />
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-[var(--muted)]">
          جارٍ تحميل الشارت…
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-[var(--danger)]">
          {error}
        </div>
      )}
    </div>
  );
}
