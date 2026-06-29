"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import {
  init,
  dispose,
  registerOverlay,
  type Chart,
  type KLineData,
} from "klinecharts";
import type { OhlcCandle } from "@/lib/ohlc/fetchOhlc";
import type { ChartDrawing } from "@/lib/chartDrawings";
import {
  drawingsToOverlays,
  type KLineOverlaySpec,
} from "@/lib/chart/klineDrawingAdapter";
import type { ChatImagePayload } from "@/lib/chatImage";
import { cn } from "@/lib/utils";

export type KLineChartHandle = {
  capturePng: () => Promise<ChatImagePayload | null>;
};

interface Props {
  symbol: string;
  /** Live candles from the user's broker via EA (no Binance, no synthetic). */
  candles: OhlcCandle[];
  /** Latest price tick to push via updateData() for a live last bar. */
  livePrice?: number;
  drawings?: ChartDrawing[];
  className?: string;
}

let rectRegistered = false;
/** Register a minimal filled-rectangle overlay for supply/demand & liquidity zones. */
function ensureRectOverlay(): void {
  if (rectRegistered) return;
  rectRegistered = true;
  try {
    registerOverlay({
      name: "rect",
      totalStep: 3,
      needDefaultPointFigure: true,
      needDefaultXAxisFigure: true,
      needDefaultYAxisFigure: true,
      createPointFigures: ({ coordinates }) => {
        if (coordinates.length < 2) return [];
        const [a, b] = coordinates;
        return [
          {
            type: "polygon",
            attrs: {
              coordinates: [
                { x: a!.x, y: a!.y },
                { x: b!.x, y: a!.y },
                { x: b!.x, y: b!.y },
                { x: a!.x, y: b!.y },
              ],
            },
            styles: { style: "stroke_fill" },
          },
        ];
      },
    });
  } catch {
    /* already registered or unsupported — overlays just skip rect */
  }
}

function toKLineData(candles: OhlcCandle[]): KLineData[] {
  return candles.map((c) => ({
    timestamp: c.time,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume ?? 0,
  }));
}

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
  for (const canvas of canvases) ctx.drawImage(canvas, 0, 0, width, height);
  const base64 = composite.toDataURL("image/png").split(",")[1];
  return base64 ?? null;
}

/**
 * Web-native KLineCharts chart. Consumes broker (EA) candles directly, applies
 * them via applyNewData/updateData, and renders the existing ChartDrawing schema
 * as live overlays through klineDrawingAdapter (stable ids → migrate, not stack).
 */
const KLineChart = forwardRef<KLineChartHandle, Props>(function KLineChart(
  { symbol, candles, livePrice, drawings, className },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<Chart | null>(null);
  const overlayIdsRef = useRef<Set<string>>(new Set());
  const lastTsRef = useRef<number>(0);

  useImperativeHandle(ref, () => ({
    capturePng: async () => {
      const el = containerRef.current;
      if (!el) return null;
      const data = compositeCanvases(el);
      return data ? { media_type: "image/png", data } : null;
    },
  }));

  // init / dispose
  useEffect(() => {
    ensureRectOverlay();
    const el = containerRef.current;
    if (!el) return;
    const chart = init(el, {
      styles: { grid: { show: true } },
    });
    chartRef.current = chart ?? null;
    return () => {
      if (el) dispose(el);
      chartRef.current = null;
      overlayIdsRef.current.clear();
      lastTsRef.current = 0;
    };
  }, []);

  // candle data: full reset when the series changes, incremental updateData on
  // a new/again last bar.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || candles.length === 0) return;
    const last = candles[candles.length - 1]!;
    const data = toKLineData(candles);
    if (lastTsRef.current === 0 || candles.length < 2) {
      chart.applyNewData(data);
    } else if (last.time >= lastTsRef.current) {
      chart.updateData(data[data.length - 1]!);
    } else {
      chart.applyNewData(data);
    }
    lastTsRef.current = last.time;
  }, [candles]);

  // live price → mutate just the last bar's close/high/low
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !livePrice || candles.length === 0) return;
    const last = candles[candles.length - 1]!;
    chart.updateData({
      timestamp: last.time,
      open: last.open,
      high: Math.max(last.high, livePrice),
      low: Math.min(last.low, livePrice),
      close: livePrice,
      volume: last.volume ?? 0,
    });
  }, [livePrice, candles]);

  // drawings → overlays (remove stale, create/migrate by stable id)
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const specs: KLineOverlaySpec[] = drawingsToOverlays(
      drawings ?? [],
      candles.length,
    );
    const nextIds = new Set(specs.map((s) => s.id));

    for (const id of overlayIdsRef.current) {
      if (!nextIds.has(id)) {
        try {
          chart.removeOverlay({ id });
        } catch {
          /* ignore */
        }
      }
    }

    for (const spec of specs) {
      try {
        // Re-create by id: KLineCharts replaces an overlay with the same id.
        chart.removeOverlay({ id: spec.id });
        chart.createOverlay({
          id: spec.id,
          name: spec.name,
          points: spec.points,
          lock: spec.lock,
          ...(spec.styles ? { styles: spec.styles } : {}),
          extendData: spec.extendData,
        });
      } catch {
        /* unknown overlay name — skip rather than crash the chart */
      }
    }
    overlayIdsRef.current = nextIds;
  }, [drawings, candles.length]);

  return (
    <div
      ref={containerRef}
      data-symbol={symbol}
      className={cn("h-full w-full", className)}
    />
  );
});

export default KLineChart;
