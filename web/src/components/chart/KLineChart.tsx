"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import type { SymbolInfo } from "@klinecharts/pro";
import type { Chart, KLineData } from "klinecharts";
import "@klinecharts/pro/dist/klinecharts-pro.css";
import "@/styles/klinecharts-pro-aichart.css";
import type { ChartDrawing } from "@/lib/chartDrawings";
import {
  parseChartDrawingsJson,
  validateChartDrawings,
} from "@/lib/chartDrawings";
import type { ChartOverlay } from "@/lib/chartOverlays";
import { profileForInterval } from "@/lib/analysisProfile";
import {
  drawingsToOverlays,
  overlayPointsForChart,
  type KLineOverlaySpec,
} from "@/lib/chart/klineDrawingAdapter";
import { mergeTradeLevelDrawings } from "@/lib/chart/tradeLevelDrawings";
import { ensureCustomOverlays } from "@/lib/chart/klineCustomOverlays";
import {
  tradeLevelsFromRecommendation,
  ChartTradeLevelsOverlay,
} from "@/components/chart/ChartTradeLevelsOverlay";
import {
  ensureKlineChartRegistry,
  findProWidgetChart,
} from "@/lib/chart/klineChartRegistry";
import { AiChartDatafeed } from "@/lib/chart/aichartDatafeed";
import { proChartPeriods, intervalToPeriod, periodToInterval } from "@/lib/chart/klinePeriod";
import {
  ensureKlineProLocale,
  KLINE_PRO_LOCALE,
} from "@/lib/chart/klineProLocale";
import type { ChatImagePayload } from "@/lib/chatImage";
import type { Recommendation } from "@/lib/types";
import { cn } from "@/lib/utils";

const TRADE_LEVEL_OVERLAY_PREFIX = "aichart_trade_";

export type KLineChartHandle = {
  capturePng: () => Promise<ChatImagePayload | null>;
};

interface Props {
  symbol: string;
  interval: string;
  market?: "crypto" | "forex";
  recommendations?: Recommendation[];
  /** Active AI recommendation — trade levels drawn on chart. */
  recommendation?: Recommendation | null;
  targets?: number[];
  overlays?: ChartOverlay[];
  drawings?: ChartDrawing[];
  livePrice?: number;
  refreshMs?: number;
  className?: string;
  /** DOM mount point inside Pro period bar for AiChart toolbar (createPortal). */
  onToolbarSlot?: (el: HTMLElement | null) => void;
  onSymbolChange?: (symbol: string) => void;
  onIntervalChange?: (interval: string) => void;
}

function toSymbolInfo(symbol: string, market: "crypto" | "forex"): SymbolInfo {
  return {
    ticker: symbol.toUpperCase(),
    shortName: symbol.toUpperCase(),
    name: symbol.toUpperCase(),
    exchange: market === "forex" ? "OANDA" : "BINANCE",
    market,
    priceCurrency: symbol.toUpperCase().includes("JPY") ? "JPY" : "USD",
    pricePrecision: symbol.toUpperCase().includes("JPY") ? 3 : 5,
    volumePrecision: 0,
    type: market === "forex" ? "FX" : "CRYPTO",
  };
}

function mountToolbarSlot(root: HTMLElement): HTMLElement | null {
  const periodBar = root.querySelector(".klinecharts-pro-period-bar");
  if (!periodBar) return null;
  let slot = periodBar.querySelector(".aichart-pro-toolbar-slot") as HTMLElement | null;
  if (!slot) {
    slot = document.createElement("div");
    slot.className = "aichart-pro-toolbar-slot";
    const firstTool = periodBar.querySelector(".item.tools");
    if (firstTool) periodBar.insertBefore(slot, firstTool);
    else periodBar.appendChild(slot);
  }
  return slot;
}

function compositeCanvases(container: HTMLElement): string | null {
  const canvases = Array.from(container.querySelectorAll("canvas"));
  if (!canvases.length) return null;
  const srcW = container.clientWidth;
  const srcH = container.clientHeight;
  if (srcW <= 0 || srcH <= 0) return null;

  const maxW = 1280;
  const scale = srcW > maxW ? maxW / srcW : 1;
  const width = Math.max(1, Math.round(srcW * scale));
  const height = Math.max(1, Math.round(srcH * scale));

  const composite = document.createElement("canvas");
  composite.width = width;
  composite.height = height;
  const ctx = composite.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#151517";
  ctx.fillRect(0, 0, width, height);
  for (const canvas of canvases) {
    ctx.drawImage(canvas, 0, 0, srcW, srcH, 0, 0, width, height);
  }
  const base64 = composite.toDataURL("image/jpeg", 0.82).split(",")[1];
  return base64 ?? null;
}

const KLineChart = forwardRef<KLineChartHandle, Props>(function KLineChart(
  {
    symbol,
    interval,
    market = "forex",
    recommendations = [],
    recommendation,
    targets = [],
    overlays,
    drawings,
    livePrice,
    refreshMs = 0,
    className,
    onToolbarSlot,
    onSymbolChange,
    onIntervalChange,
  },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [rootEl, setRootEl] = useState<HTMLElement | null>(null);
  const proRef = useRef<InstanceType<
    typeof import("@klinecharts/pro").KLineChartPro
  > | null>(null);
  const datafeedRef = useRef<AiChartDatafeed | null>(null);
  const overlayIdsRef = useRef<Set<string>>(new Set());
  const tradeLevelOverlayIdsRef = useRef<Set<string>>(new Set());
  const [candles, setCandles] = useState<KLineData[]>([]);
  const [widgetEl, setWidgetEl] = useState<HTMLElement | null>(null);
  const [chartCore, setChartCore] = useState<Chart | null>(null);
  const [error, setError] = useState<string | null>(null);
  const chartCoreRef = useRef<Chart | null>(null);
  const pushSyncRef = useRef(false);
  const lastPolledSymbolRef = useRef("");
  const lastPolledIntervalRef = useRef("");
  const onSymbolChangeRef = useRef(onSymbolChange);
  const onIntervalChangeRef = useRef(onIntervalChange);
  const onToolbarSlotRef = useRef(onToolbarSlot);
  onSymbolChangeRef.current = onSymbolChange;
  onIntervalChangeRef.current = onIntervalChange;
  onToolbarSlotRef.current = onToolbarSlot;

  useImperativeHandle(ref, () => ({
    capturePng: async () => {
      const el = containerRef.current;
      if (!el) return null;
      const data = compositeCanvases(el);
      return data ? { media_type: "image/jpeg", data } : null;
    },
  }));

  const overlayDrawings = useMemo<ChartDrawing[]>(() => {
    const lastTs = candles[candles.length - 1]?.timestamp;
    const colorFor: Record<string, string> = {
      entry: "#22c55e",
      stop_loss: "#ef4444",
      take_profit: "#3b82f6",
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

    const merged = [...overlayDrawings, ...base];
    const activeRec = recommendation ?? null;
    if (
      !activeRec ||
      (activeRec.action !== "buy" && activeRec.action !== "sell") ||
      candles.length === 0
    ) {
      return merged;
    }

    const ohlc = candles.map((c) => ({
      time: c.timestamp,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume,
    }));
    const tps =
      targets.length > 0
        ? targets.filter((t) => t > 0)
        : activeRec.take_profit != null && activeRec.take_profit > 0
          ? [activeRec.take_profit]
          : [];

    return mergeTradeLevelDrawings(merged, {
      entry: activeRec.entry,
      stop_loss: activeRec.stop_loss,
      targets: tps,
      confidence: activeRec.confidence ?? 70,
      action: activeRec.action,
    }, ohlc);
  }, [
    drawings,
    recommendations,
    recommendation,
    targets,
    symbol,
    interval,
    overlayDrawings,
    candles,
  ]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let cancelled = false;
    let attachTimer: ReturnType<typeof setInterval> | null = null;
    const bootSymbol = symbol;
    const bootInterval = interval;
    const bootMarket = market;
    const bootRefreshMs = refreshMs;

    void (async () => {
      try {
        await ensureKlineChartRegistry();
        ensureCustomOverlays();
        ensureKlineProLocale();
        const { KLineChartPro } = await import("@klinecharts/pro");
        if (cancelled) return;

        const pollMs = bootRefreshMs > 0 ? bootRefreshMs : 30_000;
        const datafeed = new AiChartDatafeed(bootMarket, pollMs);
        datafeedRef.current = datafeed;

        const pro = new KLineChartPro({
          container: el,
          theme: "dark",
          locale: KLINE_PRO_LOCALE,
          drawingBarVisible: true,
          watermark: "",
          symbol: toSymbolInfo(bootSymbol, bootMarket),
          period: intervalToPeriod(bootInterval),
          periods: proChartPeriods(),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          mainIndicators: ["MA"],
          subIndicators: ["VOL"],
          datafeed,
          styles: {
            grid: {
              horizontal: { color: "rgba(148,163,184,0.08)" },
              vertical: { color: "rgba(148,163,184,0.05)" },
            },
            candle: {
              bar: {
                upColor: "#22c55e",
                downColor: "#ef4444",
                noChangeColor: "#94a3b8",
              },
            },
          },
        });
        proRef.current = pro;
        el.classList.add("aichart-pro-root");

        let coreReady = false;
        let uiReady = false;

        const tryAttach = () => {
          if (!coreReady) {
            const core = findProWidgetChart(el);
            if (core) {
              chartCoreRef.current = core;
              setChartCore(core);
              coreReady = true;
              const list = core.getDataList?.() ?? [];
              if (list.length > 0) setCandles([...list]);
              const widget = el.querySelector(
                ".klinecharts-pro-widget",
              ) as HTMLElement | null;
              if (widget) setWidgetEl(widget);
            }
          }
          if (!uiReady) {
            const slot = mountToolbarSlot(el);
            if (slot) {
              onToolbarSlotRef.current?.(slot);
              uiReady = true;
            }
          }
          if (coreReady || uiReady) {
            chartCoreRef.current?.resize?.();
          }
          if (coreReady && uiReady && attachTimer) {
            clearInterval(attachTimer);
            attachTimer = null;
          }
        };

        tryAttach();
        if (!coreReady || !uiReady) {
          attachTimer = setInterval(tryAttach, 100);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "تعذّر تحميل الشارت.");
        }
      }
    })();

    return () => {
      cancelled = true;
      if (attachTimer) clearInterval(attachTimer);
      onToolbarSlotRef.current?.(null);
      datafeedRef.current?.unsubscribe(
        toSymbolInfo(bootSymbol, bootMarket),
        intervalToPeriod(bootInterval),
      );
      proRef.current = null;
      datafeedRef.current = null;
      chartCoreRef.current = null;
      setChartCore(null);
      setWidgetEl(null);
      el.innerHTML = "";
      overlayIdsRef.current.clear();
      tradeLevelOverlayIdsRef.current.clear();
    };
  }, []);

  useEffect(() => {
    datafeedRef.current?.setMarket(market);
    if (refreshMs > 0) datafeedRef.current?.setPollMs(refreshMs);
  }, [market, refreshMs]);

  useEffect(() => {
    const pro = proRef.current;
    if (!pro) return;
    const current = pro.getSymbol()?.ticker?.toUpperCase();
    if (current !== symbol.toUpperCase()) {
      pushSyncRef.current = true;
      pro.setSymbol(toSymbolInfo(symbol, market));
      queueMicrotask(() => {
        pushSyncRef.current = false;
      });
    }
    setError(null);
  }, [symbol, market]);

  useEffect(() => {
    const pro = proRef.current;
    if (!pro) return;
    const current = periodToInterval(pro.getPeriod());
    const next = interval;
    if (current !== next) {
      pushSyncRef.current = true;
      pro.setPeriod(intervalToPeriod(next));
      queueMicrotask(() => {
        pushSyncRef.current = false;
      });
    }
  }, [interval]);

  useEffect(() => {
    const pro = proRef.current;
    if (!pro) return;
    const tick = () => {
      if (pushSyncRef.current) return;
      const sym = pro.getSymbol()?.ticker?.toUpperCase();
      const iv = periodToInterval(pro.getPeriod());
      if (sym && sym !== lastPolledSymbolRef.current) {
        lastPolledSymbolRef.current = sym;
        onSymbolChangeRef.current?.(sym);
      }
      if (iv && iv !== lastPolledIntervalRef.current) {
        lastPolledIntervalRef.current = iv;
        onIntervalChangeRef.current?.(iv);
      }
    };
    const t = window.setInterval(tick, 400);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      chartCoreRef.current?.resize?.();
      findProWidgetChart(el)?.resize?.();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const chart = chartCoreRef.current ?? findProWidgetChart(containerRef.current);
    if (!chart) return;
    chartCoreRef.current = chart;
    setChartCore(chart);

    const sync = () => {
      const list = chart.getDataList?.() ?? [];
      if (list.length > 0) setCandles([...list]);
    };
    sync();
    const t = window.setInterval(sync, 2_000);
    return () => window.clearInterval(t);
  }, [symbol, interval, market]);

  useEffect(() => {
    const chart = chartCoreRef.current;
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

  /** Entry / SL / TP via built-in klinecharts priceLine (canvas — always visible). */
  useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setInterval> | null = null;

    const clearTradeOverlays = (chart: Chart) => {
      for (const id of tradeLevelOverlayIdsRef.current) {
        try {
          chart.removeOverlay({ id });
        } catch {
          /* ignore */
        }
      }
      tradeLevelOverlayIdsRef.current.clear();
    };

    const applyTradeLevels = (): boolean => {
      if (cancelled) return true;
      const chart =
        chartCoreRef.current ?? findProWidgetChart(containerRef.current);
      if (!chart) return false;
      const list = chart.getDataList?.() ?? [];
      if (list.length === 0) return false;
      const lastTs = list[list.length - 1]?.timestamp;
      if (!lastTs) return false;

      chartCoreRef.current = chart;
      setChartCore(chart);
      clearTradeOverlays(chart);

      if (
        !recommendation ||
        (recommendation.action !== "buy" && recommendation.action !== "sell")
      ) {
        return true;
      }

      const lines = tradeLevelsFromRecommendation(recommendation, targets);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        const id = `${TRADE_LEVEL_OVERLAY_PREFIX}${i}`;
        try {
          chart.createOverlay({
            id,
            name: "priceLine",
            points: [{ timestamp: lastTs, value: line.price }],
            lock: true,
            styles: { line: { color: line.color, size: 2 } },
          });
          tradeLevelOverlayIdsRef.current.add(id);
        } catch {
          /* skip */
        }
      }
      return true;
    };

    if (!applyTradeLevels()) {
      retryTimer = setInterval(() => {
        if (applyTradeLevels() && retryTimer) {
          clearInterval(retryTimer);
          retryTimer = null;
        }
      }, 300);
    }

    return () => {
      cancelled = true;
      if (retryTimer) clearInterval(retryTimer);
      const chart = chartCoreRef.current;
      if (chart) clearTradeOverlays(chart);
    };
  }, [recommendation, targets, symbol, interval]);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setInterval> | null = null;

    const applyOverlays = (): boolean => {
      if (cancelled) return true;
      const chart =
        chartCoreRef.current ?? findProWidgetChart(containerRef.current);
      if (!chart) return false;
      const list = chart.getDataList?.() ?? [];
      if (list.length === 0) return false;

      chartCoreRef.current = chart;
      setChartCore(chart);
      const specs: KLineOverlaySpec[] = drawingsToOverlays(effectiveDrawings, list);
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
            points: overlayPointsForChart(spec.points, list),
            lock: spec.lock,
            zLevel: spec.name === "tradeLevelLine" ? 10 : 5,
            ...(spec.styles ? { styles: spec.styles } : {}),
            extendData: spec.extendData,
          });
        } catch {
          /* skip unsupported overlay */
        }
      }
      overlayIdsRef.current = nextIds;
      return true;
    };

    if (!applyOverlays() && effectiveDrawings.length > 0) {
      retryTimer = setInterval(() => {
        if (applyOverlays() && retryTimer) {
          clearInterval(retryTimer);
          retryTimer = null;
        }
      }, 300);
    }

    return () => {
      cancelled = true;
      if (retryTimer) clearInterval(retryTimer);
    };
  }, [effectiveDrawings, interval, symbol]);

  return (
    <div
      ref={(el) => {
        rootRef.current = el;
        setRootEl(el);
      }}
      className={cn("relative h-full w-full", className)}
    >
      <div ref={containerRef} data-symbol={symbol} className="h-full w-full" />
      <ChartTradeLevelsOverlay
        chart={chartCore}
        widgetEl={widgetEl}
        mountEl={rootEl}
        recommendation={recommendation}
        targets={targets}
        candles={candles}
      />
      {error && (
        <div className="pointer-events-none absolute inset-x-0 top-2 mx-auto w-fit rounded-md bg-destructive/10 px-3 py-1 text-xs text-destructive">
          {error}
        </div>
      )}
    </div>
  );
});

export default KLineChart;
