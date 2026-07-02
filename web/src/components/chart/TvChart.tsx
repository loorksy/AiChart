"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import type {
  ChartingLibraryWidgetConstructor,
  ChartingLibraryWidgetOptions,
  IChartingLibraryWidget,
  ResolutionString,
} from "@/vendor/tradingview/charting_library";
import "@/styles/klinecharts-pro-aichart.css";
import {
  createAiChartDatafeed,
  EA_TICKER_PREFIX,
  isEaTicker,
  stripEaPrefix,
} from "@/lib/chart/tv/tvDatafeed";
import { TvDrawingManager } from "@/lib/chart/tv/tvDrawingAdapter";
import { ChartScanOverlay } from "@/components/chart/ChartScanOverlay";
import type { ChatImagePayload } from "@/lib/chatImage";
import type { ChartDrawing } from "@/lib/chartDrawings";
import type { ChartOverlay } from "@/lib/chartOverlays";
import type { Recommendation } from "@/lib/types";
import { cn } from "@/lib/utils";

declare global {
  interface Window {
    TradingView?: { widget: ChartingLibraryWidgetConstructor };
  }
}

const LIBRARY_PATH = "/charting_library/";
const SCRIPT_SRC = "/charting_library/charting_library.standalone.js";

const INTERVAL_TO_RES: Record<string, string> = {
  "1m": "1",
  "3m": "3",
  "5m": "5",
  "15m": "15",
  "30m": "30",
  "1h": "60",
  "2h": "120",
  "4h": "240",
  "1d": "1D",
  D: "1D",
  "1w": "1W",
  W: "1W",
};

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
  "1W": "1w",
};

function toResolution(interval: string): ResolutionString {
  return (INTERVAL_TO_RES[interval] ?? "15") as ResolutionString;
}

function fromResolution(res: string): string {
  return RES_TO_INTERVAL[res] ?? "15m";
}

let scriptPromise: Promise<void> | null = null;
function loadTvScript(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.TradingView?.widget) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${SCRIPT_SRC}"]`,
    );
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("tv load")));
      if (window.TradingView?.widget) resolve();
      return;
    }
    const s = document.createElement("script");
    s.src = SCRIPT_SRC;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("tv load"));
    document.head.appendChild(s);
  });
  return scriptPromise;
}

export type TvChartHandle = {
  capturePng: () => Promise<ChatImagePayload | null>;
  currentSymbol: () => string;
  /** Underlying widget (for drawing overlays in later phases). */
  widget: () => IChartingLibraryWidget | null;
};

/** Buttons rendered INSIDE the TradingView header (not a separate layer). */
export interface TvHeaderAction {
  id: string;
  text: string;
  title?: string;
  /** Accent color for the button text (e.g. analyze green). */
  color?: string;
  onClick?: () => void;
}

interface Props {
  symbol: string;
  interval: string;
  market?: "crypto" | "forex";
  analyzing?: boolean;
  /** Active AI recommendation — entry/SL/TP drawn as native TV lines. */
  recommendation?: Recommendation | null;
  targets?: number[];
  overlays?: ChartOverlay[];
  drawings?: ChartDrawing[];
  /** Platform actions embedded in the TV header toolbar. */
  headerActions?: TvHeaderAction[];
  /** Offer the user's broker (EA/MT5) as a second data source in symbol search. */
  eaEnabled?: boolean;
  /** Active data source for the current symbol. */
  dataSource?: "oanda" | "ea";
  className?: string;
  onSymbolChange?: (symbol: string, source: "oanda" | "ea") => void;
  onIntervalChange?: (interval: string) => void;
}

function overlaysToDrawings(overlays: ChartOverlay[] | undefined): ChartDrawing[] {
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
      points: [{ price: o.price }],
      price: o.price,
    }));
}

const TvChart = forwardRef<TvChartHandle, Props>(function TvChart(
  {
    symbol,
    interval,
    market = "forex",
    analyzing = false,
    recommendation,
    targets = [],
    overlays,
    drawings,
    headerActions,
    eaEnabled = false,
    dataSource = "oanda",
    className,
    onSymbolChange,
    onIntervalChange,
  },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetRef = useRef<IChartingLibraryWidget | null>(null);
  const managerRef = useRef<TvDrawingManager | null>(null);
  const readyRef = useRef(false);
  const [ready, setReady] = useState(false);
  const headerButtonsRef = useRef<Map<string, HTMLElement>>(new Map());
  const headerActionsRef = useRef<TvHeaderAction[] | undefined>(headerActions);
  headerActionsRef.current = headerActions;
  // Stable indirection so the mount effect can call the latest applyDrawings.
  const applyDrawingsRef = useRef<() => void>(() => {});
  const pushSyncRef = useRef(false);
  const onSymbolChangeRef = useRef(onSymbolChange);
  const onIntervalChangeRef = useRef(onIntervalChange);
  onSymbolChangeRef.current = onSymbolChange;
  onIntervalChangeRef.current = onIntervalChange;

  useImperativeHandle(ref, () => ({
    capturePng: async () => {
      const w = widgetRef.current;
      if (!w || !readyRef.current) return null;
      try {
        const src = await w.takeClientScreenshot();
        // Downscale to <=1280px at capture time so the /api/market/analyze POST
        // body stays small (a raw TV screenshot is huge → HTTP/2 body errors).
        const maxW = 1280;
        const scale = src.width > maxW ? maxW / src.width : 1;
        const width = Math.max(1, Math.round(src.width * scale));
        const height = Math.max(1, Math.round(src.height * scale));
        const out = document.createElement("canvas");
        out.width = width;
        out.height = height;
        const ctx = out.getContext("2d");
        if (!ctx) return null;
        ctx.fillStyle = "#0f1115";
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(src, 0, 0, width, height);
        const base64 = out.toDataURL("image/jpeg", 0.82).split(",")[1];
        return base64 ? { media_type: "image/jpeg", data: base64 } : null;
      } catch {
        return null;
      }
    },
    currentSymbol: () => {
      const w = widgetRef.current;
      if (!w || !readyRef.current) return symbol.toUpperCase();
      try {
        const s = w.activeChart().symbol();
        // Strip any namespace (EA:/MT5:/OANDA:) — analysis wants the bare pair.
        const ticker = s.includes(":") ? s.split(":").pop()! : s;
        return ticker.toUpperCase();
      } catch {
        return symbol.toUpperCase();
      }
    },
    widget: () => widgetRef.current,
  }));

  // Mount the widget once.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let cancelled = false;
    const bootSymbol =
      dataSource === "ea"
        ? `${EA_TICKER_PREFIX}${symbol}`
        : symbol.toUpperCase();
    const bootInterval = interval;
    const bootMarket = market;
    const bootEa = eaEnabled;

    void (async () => {
      try {
        await loadTvScript();
        if (cancelled || !window.TradingView?.widget) return;

        const options: ChartingLibraryWidgetOptions = {
          container: el,
          library_path: LIBRARY_PATH,
          datafeed: createAiChartDatafeed(bootMarket, { eaEnabled: bootEa }),
          symbol: bootSymbol,
          interval: toResolution(bootInterval),
          locale: "ar",
          theme: "dark",
          autosize: true,
          timezone: "Etc/UTC",
          disabled_features: [
            "use_localstorage_for_settings",
            "header_saveload",
            "popup_hints",
          ],
          enabled_features: ["hide_left_toolbar_by_default"],
          overrides: {
            "paneProperties.background": "#0f1115",
            "paneProperties.backgroundType": "solid",
          },
          loading_screen: { backgroundColor: "#0f1115" },
        };

        const w = new window.TradingView.widget(options);
        widgetRef.current = w;

        // Platform actions live INSIDE the TV header toolbar (no overlay layer).
        void w.headerReady().then(() => {
          if (cancelled) return;
          for (const a of headerActionsRef.current ?? []) {
            const el = w.createButton();
            el.textContent = a.text;
            if (a.title) el.setAttribute("title", a.title);
            el.style.direction = "rtl";
            el.style.fontWeight = "600";
            el.style.whiteSpace = "nowrap";
            el.style.cursor = a.onClick ? "pointer" : "default";
            if (a.color) el.style.color = a.color;
            el.addEventListener("click", () => {
              headerActionsRef.current
                ?.find((x) => x.id === a.id)
                ?.onClick?.();
            });
            headerButtonsRef.current.set(a.id, el);
          }
        });

        w.onChartReady(() => {
          if (cancelled) return;
          readyRef.current = true;
          const chart = w.activeChart();
          managerRef.current = new TvDrawingManager(chart);
          setReady(true);
          // Re-anchor drawings after fresh history lands (frame/pair switch).
          chart.onDataLoaded().subscribe(null, () => {
            if (pendingReapplyRef.current) {
              pendingReapplyRef.current = false;
              applyDrawingsRef.current();
            }
          });
          chart.onSymbolChanged().subscribe(null, () => {
            if (pushSyncRef.current) return;
            const s = chart.symbol();
            // "EA:EURUSDm" / "MT5:EURUSDm" → broker source; else OANDA.
            const viaEa = isEaTicker(s) || s.startsWith("MT5:");
            const ticker = (s.includes(":") ? s.split(":").pop()! : s).toUpperCase();
            onSymbolChangeRef.current?.(ticker, viaEa ? "ea" : "oanda");
          });
          chart.onIntervalChanged().subscribe(null, (res: ResolutionString) => {
            if (pushSyncRef.current) return;
            onIntervalChangeRef.current?.(fromResolution(res));
          });
        });
      } catch {
        /* script/init failure — container stays empty */
      }
    })();

    return () => {
      cancelled = true;
      readyRef.current = false;
      setReady(false);
      managerRef.current = null;
      headerButtonsRef.current.clear();
      try {
        widgetRef.current?.remove();
      } catch {
        /* ignore */
      }
      widgetRef.current = null;
    };
  }, []);

  // React symbol/source → widget (broker symbols carry the EA: namespace).
  useEffect(() => {
    const w = widgetRef.current;
    if (!w || !readyRef.current) return;
    try {
      const chart = w.activeChart();
      const current = chart.symbol();
      const currentEa = isEaTicker(current) || current.startsWith("MT5:");
      const currentBare = (
        current.includes(":") ? current.split(":").pop()! : current
      ).toUpperCase();
      const wantEa = dataSource === "ea";
      if (currentBare !== symbol.toUpperCase() || currentEa !== wantEa) {
        pushSyncRef.current = true;
        const target = wantEa
          ? `${EA_TICKER_PREFIX}${stripEaPrefix(symbol)}`
          : symbol.toUpperCase();
        chart.setSymbol(target, () => {
          pushSyncRef.current = false;
        });
      }
    } catch {
      pushSyncRef.current = false;
    }
  }, [symbol, dataSource]);

  // React interval → widget.
  useEffect(() => {
    const w = widgetRef.current;
    if (!w || !readyRef.current) return;
    try {
      const chart = w.activeChart();
      const target = toResolution(interval);
      if (chart.resolution() !== target) {
        pushSyncRef.current = true;
        chart.setResolution(target, () => {
          pushSyncRef.current = false;
        });
      }
    } catch {
      pushSyncRef.current = false;
    }
  }, [interval]);

  // Latest draw args (for deferred re-apply after new data loads).
  const drawArgsRef = useRef<{
    drawings?: ChartDrawing[];
    overlays?: ChartOverlay[];
    recommendation?: Recommendation | null;
    targets: number[];
    symbol: string;
    interval: string;
  }>({ drawings, overlays, recommendation, targets, symbol, interval });
  drawArgsRef.current = { drawings, overlays, recommendation, targets, symbol, interval };
  const pendingReapplyRef = useRef(false);

  const applyDrawings = useCallback(() => {
    const mgr = managerRef.current;
    if (!mgr || !readyRef.current) return;
    const a = drawArgsRef.current;
    const combined = [...overlaysToDrawings(a.overlays), ...(a.drawings ?? [])];
    mgr.apply(
      combined,
      { recommendation: a.recommendation, targets: a.targets },
      { symbol: a.symbol, interval: a.interval },
    );
  }, []);
  applyDrawingsRef.current = applyDrawings;

  // Content changed (new analysis / cleared) → redraw now.
  useEffect(() => {
    if (!ready) return;
    applyDrawings();
  }, [ready, drawings, overlays, recommendation, targets, applyDrawings]);

  // Frame/symbol changed → drawings survive; re-anchor once fresh data lands
  // (drawing on a still-loading chart can silently drop shapes).
  useEffect(() => {
    if (!ready) return;
    pendingReapplyRef.current = true;
  }, [ready, symbol, interval]);

  // Keep TV header button labels in sync with React state (credits, counts).
  useEffect(() => {
    for (const a of headerActions ?? []) {
      const el = headerButtonsRef.current.get(a.id);
      if (!el) continue;
      if (el.textContent !== a.text) el.textContent = a.text;
      if (a.color) el.style.color = a.color;
      if (a.title) el.setAttribute("title", a.title);
    }
  }, [headerActions]);

  return (
    <div className={cn("relative h-full w-full", className)}>
      <div ref={containerRef} data-symbol={symbol} className="h-full w-full" />
      <ChartScanOverlay active={analyzing} />
    </div>
  );
});

export default TvChart;
