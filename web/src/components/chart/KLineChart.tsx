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
  init,
  dispose,
  registerOverlay,
  type Chart,
  type KLineData,
} from "klinecharts";
import type { ChartDrawing } from "@/lib/chartDrawings";
import {
  parseChartDrawingsJson,
  validateChartDrawings,
} from "@/lib/chartDrawings";
import type { ChartOverlay } from "@/lib/chartOverlays";
import { profileForInterval } from "@/lib/analysisProfile";
import {
  drawingsToOverlays,
  type KLineOverlaySpec,
} from "@/lib/chart/klineDrawingAdapter";
import type { ChatImagePayload } from "@/lib/chatImage";
import type { Recommendation } from "@/lib/types";
import { cn } from "@/lib/utils";

export type KLineChartHandle = {
  capturePng: () => Promise<ChatImagePayload | null>;
};

interface Props {
  symbol: string;
  interval: string;
  market?: "crypto" | "forex";
  recommendations?: Recommendation[];
  overlays?: ChartOverlay[];
  drawings?: ChartDrawing[];
  livePrice?: number;
  /** Re-fetch candles on this interval (ms) for a live preview (0 = off). */
  refreshMs?: number;
  className?: string;
}

interface RawCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

let rectRegistered = false;
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
    /* already registered or unsupported */
  }
}

/** klines endpoint returns time in SECONDS; KLineCharts wants ms timestamps. */
function toKLineData(rows: RawCandle[]): KLineData[] {
  return rows.map((c) => ({
    timestamp: c.time > 1e12 ? c.time : c.time * 1000,
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
 * Web-native KLineCharts chart. Fetches broker (forex→EA) candles via
 * /api/market/klines, applies them with applyNewData/updateData, and renders the
 * existing ChartDrawing schema as live overlays through klineDrawingAdapter
 * (stable ids → migrate, not stack). No Binance stream, no synthetic data.
 */
const KLineChart = forwardRef<KLineChartHandle, Props>(function KLineChart(
  {
    symbol,
    interval,
    market = "forex",
    recommendations = [],
    overlays,
    drawings,
    livePrice,
    refreshMs = 0,
    className,
  },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<Chart | null>(null);
  const overlayIdsRef = useRef<Set<string>>(new Set());
  const [candleCount, setCandleCount] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useImperativeHandle(ref, () => ({
    capturePng: async () => {
      const el = containerRef.current;
      if (!el) return null;
      const data = compositeCanvases(el);
      return data ? { media_type: "image/png", data } : null;
    },
  }));

  // Overlays (entry/stop/target/level price lines) → horizontal price_line drawings.
  const overlayDrawings = useMemo<ChartDrawing[]>(() => {
    const colorFor: Record<string, string> = {
      entry: "#3b82f6",
      stop_loss: "#ef4444",
      take_profit: "#22c55e",
      support: "#22c55e",
      resistance: "#ef4444",
    };
    return (overlays ?? [])
      .filter((o) => o.price > 0)
      .map((o) => ({
        type: "price_line" as const,
        confidence: 80,
        label: o.label,
        color: colorFor[o.type] ?? "#94a3b8",
        points: [{ barsAhead: 0, price: o.price }],
        price: o.price,
      }));
  }, [overlays]);

  // Fall back to the latest actionable recommendation's drawings when the
  // analyze flow hasn't supplied explicit ones.
  const effectiveDrawings = useMemo<ChartDrawing[]>(() => {
    const base = drawings?.length
      ? drawings
      : (() => {
          const rec = [...recommendations]
            .reverse()
            .find(
              (r) =>
                r.symbol?.toUpperCase() === symbol.toUpperCase() &&
                (r.action === "buy" || r.action === "sell"),
            );
          if (!rec) return [] as ChartDrawing[];
          const raw = parseChartDrawingsJson(rec.chart_drawings_json);
          return raw.length
            ? validateChartDrawings(raw, rec.action, rec.confidence ?? 60, profileForInterval(interval))
            : [];
        })();
    return [...overlayDrawings, ...base];
  }, [drawings, recommendations, symbol, interval, overlayDrawings]);

  // init / dispose
  useEffect(() => {
    ensureRectOverlay();
    const el = containerRef.current;
    if (!el) return;
    const chart = init(el, { styles: { grid: { show: true } } });
    chartRef.current = chart ?? null;
    return () => {
      if (el) dispose(el);
      chartRef.current = null;
      overlayIdsRef.current.clear();
    };
  }, []);

  // candle data load + optional live refresh
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const load = async () => {
      try {
        const res = await fetch(
          `/api/market/klines?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&market=${market}&limit=300`,
          { cache: "no-store" },
        );
        const data = (await res.json()) as { candles?: RawCandle[]; error?: string };
        if (cancelled) return;
        const rows = data.candles ?? [];
        if (rows.length === 0) {
          setError(data.error ?? "لا تتوفر شموع من الوسيط — تأكد من اتصال EA.");
          return;
        }
        setError(null);
        const chart = chartRef.current;
        if (!chart) return;
        chart.applyNewData(toKLineData(rows));
        setCandleCount(rows.length);
      } catch {
        if (!cancelled) setError("تعذّر جلب الشموع.");
      }
    };

    void load();
    if (refreshMs > 0) timer = setInterval(load, refreshMs);
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [symbol, interval, market, refreshMs]);

  // live price → mutate the last bar
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !livePrice || candleCount === 0) return;
    const list = chart.getDataList();
    const last = list[list.length - 1];
    if (!last) return;
    chart.updateData({
      timestamp: last.timestamp,
      open: last.open,
      high: Math.max(last.high, livePrice),
      low: Math.min(last.low, livePrice),
      close: livePrice,
      volume: last.volume ?? 0,
    });
  }, [livePrice, candleCount]);

  // drawings → overlays (remove stale, create/migrate by stable id)
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const specs: KLineOverlaySpec[] = drawingsToOverlays(effectiveDrawings, candleCount);
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
  }, [effectiveDrawings, candleCount]);

  return (
    <div className={cn("relative h-full w-full", className)}>
      <div ref={containerRef} data-symbol={symbol} className="h-full w-full" />
      {error && (
        <div className="pointer-events-none absolute inset-x-0 top-2 mx-auto w-fit rounded-md bg-destructive/10 px-3 py-1 text-xs text-destructive">
          {error}
        </div>
      )}
    </div>
  );
});

export default KLineChart;
