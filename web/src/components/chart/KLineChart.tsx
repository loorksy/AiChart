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
import { normalizeTimestamp } from "@/lib/chart/chartTimeAnchor";
import {
  drawingsToOverlays,
  type KLineOverlaySpec,
} from "@/lib/chart/klineDrawingAdapter";
import { ensureCustomOverlays } from "@/lib/chart/klineCustomOverlays";
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

function toKLineData(rows: RawCandle[]): KLineData[] {
  return rows.map((c) => ({
    timestamp: normalizeTimestamp(c.time),
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
  const [candles, setCandles] = useState<KLineData[]>([]);
  const [error, setError] = useState<string | null>(null);

  useImperativeHandle(ref, () => ({
    capturePng: async () => {
      const el = containerRef.current;
      if (!el) return null;
      const data = compositeCanvases(el);
      return data ? { media_type: "image/png", data } : null;
    },
  }));

  const overlayDrawings = useMemo<ChartDrawing[]>(() => {
    const lastTs = candles[candles.length - 1]?.timestamp;
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
        anchorMode: "time_price" as const,
        points: [{ time: lastTs ?? 0, price: o.price }],
        price: o.price,
      }));
  }, [overlays, candles]);

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
            ? validateChartDrawings(
                raw,
                rec.action,
                rec.confidence ?? 60,
                profileForInterval(interval),
              )
            : [];
        })();
    return [...overlayDrawings, ...base];
  }, [drawings, recommendations, symbol, interval, overlayDrawings]);

  useEffect(() => {
    ensureCustomOverlays();
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
        const klines = toKLineData(rows);
        const chart = chartRef.current;
        if (!chart) return;
        chart.applyNewData(klines);
        setCandles(klines);
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

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !livePrice || candles.length === 0) return;
    const last = candles[candles.length - 1];
    if (!last) return;
    chart.updateData({
      timestamp: last.timestamp,
      open: last.open,
      high: Math.max(last.high, livePrice),
      low: Math.min(last.low, livePrice),
      close: livePrice,
      volume: last.volume ?? 0,
    });
  }, [livePrice, candles]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || candles.length === 0) return;

    const specs: KLineOverlaySpec[] = drawingsToOverlays(effectiveDrawings, candles);
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
        /* skip unsupported overlay */
      }
    }
    overlayIdsRef.current = nextIds;
  }, [effectiveDrawings, candles, interval]);

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
