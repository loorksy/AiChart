"use client";

import type { MarketDataSource } from "@/lib/markets/marketDataSource";
import { normalizeSymbolCase } from "@/lib/markets/symbolCase";
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
import { createAiChartDatafeed } from "@/lib/chart/tv/tvDatafeed";
import type { TvLatestCandle } from "@/lib/chart/tv/tvDatafeed";
import { TvDrawingManager } from "@/lib/chart/tv/tvDrawingAdapter";
import { TvStudyManager } from "@/lib/chart/tv/tvStudyAdapter";
import type { ChartStudy } from "@/lib/chart/studies";
import {
  applyUserDrawingMutations,
  readSelectedUserDrawingId,
  readUserDrawings,
} from "@/lib/chart/tv/tvUserDrawings";
import type {
  SerializedChartDrawing,
  UserDrawingMutationCommand,
} from "@/lib/chart/drawings/types";
import { ChartScanOverlay } from "@/components/chart/ChartScanOverlay";
import type { ChatImagePayload } from "@/lib/chatImage";
import type { ChartDrawing } from "@/lib/chartDrawings";
import type { ChartOverlay } from "@/lib/chartOverlays";
import type { Recommendation } from "@/lib/types";
import { barDurationSec } from "@/lib/intervals";
import { CHART_CAPTURE_CANDLES } from "@/lib/chart/captureWindow";
import {
  LOCALE_STORAGE_KEY,
  dirForLocale,
  isAppLocale,
  type AppLocale,
  type Direction,
} from "@/lib/i18n";
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

export type TvChartSnapshotResult = {
  pngBase64: string;
  drawingsRendered: number;
  studiesRendered: number;
};

export type TvChartHandle = {
  capturePng: () => Promise<ChatImagePayload | null>;
  /**
   * Agent live-capture: PNG of the rendered widget via takeClientScreenshot.
   * When includeDrawings/includeStudies are false the matching layers are
   * hidden for the shot and restored afterwards — still TradingView, never
   * a server-side redraw.
   */
  captureSnapshot: (opts?: {
    includeDrawings?: boolean;
    includeStudies?: boolean;
    symbol?: string;
    interval?: string;
  }) => Promise<TvChartSnapshotResult | null>;
  currentSymbol: () => string;
  latestCandle: () => TvLatestCandle | null;
  /** Visible time window (unix seconds) so the agent can reason on what the
   *  user is actually looking at (trendlines, support/resistance in view). */
  visibleRange: () => { from: number; to: number } | undefined;
  /** Safe, serialized user-drawn shapes (all chart shapes minus app-owned). */
  getUserDrawings: () => SerializedChartDrawing[];
  /** The user's currently-selected manual drawing id (if exactly one). */
  getSelectedUserDrawingId: () => string | undefined;
  /** Apply the agent's validated user-drawing mutations onto the native shapes. */
  applyUserDrawingMutations: (commands: UserDrawingMutationCommand[]) => void;
  /** Re-request bars from the datafeed without tearing the widget down. */
  reload: () => void;
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
  market?: "forex";
  analyzing?: boolean;
  /** Active AI recommendation — entry/SL/TP drawn as native TV lines. */
  recommendation?: Recommendation | null;
  targets?: number[];
  overlays?: ChartOverlay[];
  drawings?: ChartDrawing[];
  /** Agent-enabled indicators (RSI/EMA/…) mirrored as native TV studies. */
  studies?: ChartStudy[];
  /** Platform actions embedded in the TV header toolbar. */
  headerActions?: TvHeaderAction[];
  /** Active data source for the current symbol. */
  dataSource?: MarketDataSource;
  /** TradingView language is selected when the widget is created. */
  locale?: AppLocale;
  direction?: Direction;
  theme?: "light" | "dark";
  /** Headless screenshot render: drop every toolbar so the PNG is chart only. */
  capture?: boolean;
  /**
   * Chrome-free live pane for MCP / iframe hosts: same toolbar strip as capture,
   * but the datafeed keeps streaming ticks and the pane background is transparent.
   */
  embed?: boolean;
  className?: string;
  onSymbolChange?: (symbol: string, source: MarketDataSource) => void;
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
    studies,
    headerActions,
    dataSource = "oanda",
    locale = "ar",
    direction = "rtl",
    theme = "dark",
    capture = false,
    embed = false,
    className,
    onSymbolChange,
    onIntervalChange,
  },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetRef = useRef<IChartingLibraryWidget | null>(null);
  const managerRef = useRef<TvDrawingManager | null>(null);
  const studyManagerRef = useRef<TvStudyManager | null>(null);
  const readyRef = useRef(false);
  const [ready, setReady] = useState(false);
  const headerButtonsRef = useRef<Map<string, HTMLElement>>(new Map());
  const headerActionsRef = useRef<TvHeaderAction[] | undefined>(headerActions);
  const directionRef = useRef<Direction>(direction);
  // Read inside the mount effect, which runs once and must not re-run when
  // unrelated props change.
  const captureRef = useRef(capture);
  const embedRef = useRef(embed);
  headerActionsRef.current = headerActions;
  directionRef.current = direction;
  captureRef.current = capture;
  embedRef.current = embed;
  // Stable indirection so the mount effect can call the latest applyDrawings.
  const applyDrawingsRef = useRef<(opts?: { force?: boolean }) => void>(() => {});
  const pushSyncRef = useRef(false);
  const latestCandleRef = useRef<TvLatestCandle | null>(null);
  const clearLatestCandle = () => {
    latestCandleRef.current = null;
  };
  const onSymbolChangeRef = useRef(onSymbolChange);
  const onIntervalChangeRef = useRef(onIntervalChange);
  onSymbolChangeRef.current = onSymbolChange;
  onIntervalChangeRef.current = onIntervalChange;

  useImperativeHandle(ref, () => ({
    captureSnapshot: async (opts) => {
      const w = widgetRef.current;
      if (!w || !readyRef.current) return null;
      const includeDrawings = opts?.includeDrawings !== false;
      const includeStudies = opts?.includeStudies !== false;
      const chart = w.activeChart();
      const restoreSymbol = normalizeSymbolCase(symbol);
      const restoreInterval = interval;
      let hidDrawings = false;
      let hidStudies = false;
      let previousRange: { from: number; to: number } | null = null;
      const previousHide =
        typeof w.hideAllDrawingTools === "function"
          ? w.hideAllDrawingTools().value()
          : false;

      const waitCb = (fn: (cb: () => void) => void, timeoutMs = 2500) =>
        new Promise<void>((resolve) => {
          let done = false;
          const finish = () => {
            if (done) return;
            done = true;
            resolve();
          };
          const timer = window.setTimeout(finish, timeoutMs);
          try {
            fn(() => {
              window.clearTimeout(timer);
              finish();
            });
          } catch {
            window.clearTimeout(timer);
            finish();
          }
        });

      try {
        if (opts?.symbol) {
          const wanted = normalizeSymbolCase(opts.symbol);
          const current = chart.symbol();
          const currentBare = normalizeSymbolCase(
            current.includes(":") ? current.split(":").pop()! : current,
          );
          if (currentBare !== wanted) {
            await waitCb((cb) => chart.setSymbol(wanted, cb));
          }
        }
        if (opts?.interval) {
          const target = toResolution(opts.interval);
          if (chart.resolution() !== target) {
            await waitCb((cb) => chart.setResolution(target, cb));
          }
        }

        if (!includeDrawings && typeof w.hideAllDrawingTools === "function") {
          w.hideAllDrawingTools().setValue(true);
          hidDrawings = true;
        }
        if (!includeStudies) {
          try {
            chart.removeAllStudies();
            hidStudies = true;
          } catch {
            /* studies already empty / API refused */
          }
        }

        try {
          const range = chart.getVisibleRange();
          if (
            range &&
            Number.isFinite(range.from) &&
            Number.isFinite(range.to)
          ) {
            previousRange = { from: range.from, to: range.to };
          }
        } catch {
          previousRange = null;
        }
        const barSec = Math.max(1, barDurationSec(opts?.interval ?? interval));
        const rangeTo = Math.floor(Date.now() / 1000) + barSec;
        const rangeFrom = rangeTo - CHART_CAPTURE_CANDLES * barSec;
        try {
          await chart.setVisibleRange({ from: rangeFrom, to: rangeTo });
        } catch {
          /* keep current zoom if the library refuses the range */
        }

        await new Promise((r) => window.setTimeout(r, 200));

        let drawingsRendered = 0;
        let studiesRendered = 0;
        try {
          drawingsRendered = includeDrawings ? chart.getAllShapes().length : 0;
        } catch {
          drawingsRendered = includeDrawings
            ? managerRef.current?.trackedIds().length ?? 0
            : 0;
        }
        try {
          studiesRendered = includeStudies ? chart.getAllStudies().length : 0;
        } catch {
          studiesRendered = includeStudies
            ? studyManagerRef.current?.appliedFingerprints().length ?? 0
            : 0;
        }

        const src = await w.takeClientScreenshot();
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
        const pngBase64 = out.toDataURL("image/png").split(",")[1];
        if (!pngBase64) return null;
        return { pngBase64, drawingsRendered, studiesRendered };
      } catch {
        return null;
      } finally {
        if (hidDrawings && typeof w.hideAllDrawingTools === "function") {
          try {
            w.hideAllDrawingTools().setValue(previousHide);
          } catch {
            /* widget torn down */
          }
        }
        if (hidStudies) {
          try {
            studyManagerRef.current?.apply(studies ?? []);
          } catch {
            /* restore best-effort */
          }
        }
        try {
          const current = chart.symbol();
          const currentBare = normalizeSymbolCase(
            current.includes(":") ? current.split(":").pop()! : current,
          );
          if (currentBare !== restoreSymbol) {
            chart.setSymbol(restoreSymbol, () => {});
          }
          if (chart.resolution() !== toResolution(restoreInterval)) {
            chart.setResolution(toResolution(restoreInterval), () => {});
          }
          if (previousRange) {
            void chart.setVisibleRange(previousRange);
          }
        } catch {
          /* restore best-effort */
        }
      }
    },
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
      if (!w || !readyRef.current) return normalizeSymbolCase(symbol);
      try {
        const s = w.activeChart().symbol();
        // Strip any exchange namespace (e.g. OANDA:) — analysis wants the bare pair.
        const ticker = s.includes(":") ? s.split(":").pop()! : s;
        return normalizeSymbolCase(ticker);
      } catch {
        return normalizeSymbolCase(symbol);
      }
    },
    latestCandle: () => latestCandleRef.current,
    visibleRange: () => {
      const w = widgetRef.current;
      if (!w || !readyRef.current) return undefined;
      try {
        const range = w.activeChart().getVisibleRange();
        if (!range || !Number.isFinite(range.from) || !Number.isFinite(range.to)) {
          return undefined;
        }
        // TV reports unix seconds; the agent's warehouse queries use ms.
        return { from: range.from * 1000, to: range.to * 1000 };
      } catch {
        return undefined;
      }
    },
    getUserDrawings: () => {
      const w = widgetRef.current;
      const mgr = managerRef.current;
      if (!w || !mgr || !readyRef.current) return [];
      try {
        return readUserDrawings({
          chart: w.activeChart(),
          trackedIds: mgr.trackedIds(),
          symbol: normalizeSymbolCase(symbol),
          interval,
        });
      } catch {
        return [];
      }
    },
    getSelectedUserDrawingId: () => {
      const w = widgetRef.current;
      const mgr = managerRef.current;
      if (!w || !mgr || !readyRef.current) return undefined;
      try {
        return readSelectedUserDrawingId({
          chart: w.activeChart(),
          trackedIds: mgr.trackedIds(),
        });
      } catch {
        return undefined;
      }
    },
    applyUserDrawingMutations: (commands) => {
      const w = widgetRef.current;
      const mgr = managerRef.current;
      if (!w || !mgr || !readyRef.current || !commands.length) return;
      try {
        applyUserDrawingMutations({
          chart: w.activeChart(),
          trackedIds: mgr.trackedIds(),
          commands,
        });
      } catch {
        /* chart not ready / TV rejected — no-op */
      }
    },
    reload: () => {
      // resetData, not a remount: the operator's drawings and the agent's
      // levels are widget state, and a remount would take both with it.
      if (!readyRef.current) return;
      try {
        widgetRef.current?.activeChart().resetData();
      } catch {
        /* widget torn down mid-click */
      }
    },
    widget: () => widgetRef.current,
  }));

  // Mount the widget once per language. TradingView takes its UI locale at
  // construction only, so this is the one prop change that justifies a teardown:
  // without it, switching the platform language left the chart speaking the old
  // one until a full page reload. Agent levels re-apply from props after the
  // remount; anything drawn by hand inside the widget is the accepted cost of an
  // explicit language switch.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let cancelled = false;
    const bootSymbol = normalizeSymbolCase(symbol);
    const bootInterval = interval;
    const bootMarket = market;
    const persistedLocale = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    const bootLocale = isAppLocale(persistedLocale)
      ? locale === persistedLocale
        ? persistedLocale
        : locale
      : locale;
    const bootDirection = dirForLocale(bootLocale);
    const bootTheme = theme;

    void (async () => {
      try {
        await loadTvScript();
        if (cancelled || !window.TradingView?.widget) return;

        // Capture mode: the server opens this page headlessly to photograph the
        // operator's chart. Toolbars are application chrome, not chart content,
        // so they are stripped — the PNG should be the chart and nothing else.
        // Read from the prop (the server resolved it) rather than sniffing the
        // URL, which a client-side navigation can rewrite before this runs.
        const isCapture = captureRef.current;
        const isEmbed = embedRef.current;
        const paneBg = isEmbed
          ? "rgba(0,0,0,0)"
          : bootTheme === "dark"
            ? "#050505"
            : "#f4f5f7";

        // Live and capture both drop TradingView's own top/bottom chrome.
        // Interval stays in the composer; refresh lives in the console top bar.
        // Legend keeps price/volume — only the series title (XAUUSD · OANDA)
        // is hidden via overrides below.
        const disabled: ChartingLibraryWidgetOptions["disabled_features"] = [
          "use_localstorage_for_settings",
          "header_saveload",
          "popup_hints",
          "header_compare",
          // Drawing tools are the agent's job — levels arrive programmatically.
          "left_toolbar",
          "header_widget",
          "header_indicators",
          "timeframes_toolbar",
          "control_bar",
          ...(isCapture || isEmbed ? (["legend_context_menu"] as const) : []),
        ];

        const options = {
          container: el,
          library_path: LIBRARY_PATH,
          datafeed: createAiChartDatafeed(bootMarket, {
            onLatestCandle: (candle) => {
              latestCandleRef.current = candle;
            },
          }),
          symbol: bootSymbol,
          interval: toResolution(bootInterval),
          locale: bootLocale,
          theme: bootTheme,
          autosize: true,
          timezone: "Etc/UTC",
          custom_css_url: "aichart-hide-series-title.css",
          disabled_features: disabled,
          enabled_features: isCapture || isEmbed
            ? []
            : ([
                "display_legend_on_all_charts",
                "seconds_resolution",
                "hide_resolution_in_legend",
              ] as const),
          overrides: {
            "paneProperties.background": paneBg,
            "paneProperties.backgroundType": "solid",
            "paneProperties.legendProperties.showSeriesTitle": false,
            "paneProperties.legendProperties.showSeriesOHLC": true,
            "paneProperties.legendProperties.showBarChange": true,
            "paneProperties.legendProperties.showVolume": true,
          },
          loading_screen: {
            backgroundColor: paneBg,
          },
        } as ChartingLibraryWidgetOptions;

        const w = new window.TradingView.widget(options);
        widgetRef.current = w;

        w.onChartReady(() => {
          if (cancelled) return;
          w.applyOverrides({
            "paneProperties.legendProperties.showSeriesTitle": false,
          });
          readyRef.current = true;
          const chart = w.activeChart();
          managerRef.current = new TvDrawingManager(chart);
          studyManagerRef.current = new TvStudyManager(chart);
          setReady(true);
          // Re-anchor drawings after fresh history lands (frame/pair switch).
          chart.onDataLoaded().subscribe(null, () => {
            if (pendingReapplyRef.current) {
              pendingReapplyRef.current = false;
              // Force: after a frame/symbol switch the shapes must be rebuilt
              // even when the payload fingerprint is unchanged.
              applyDrawingsRef.current({ force: true });
            }
          });
          chart.onSymbolChanged().subscribe(null, () => {
            if (pushSyncRef.current) return;
            clearLatestCandle();
            const s = chart.symbol();
            const ticker = (s.includes(":") ? s.split(":").pop()! : s);
            // Every symbol is served by the platform OANDA feed.
            onSymbolChangeRef.current?.(ticker, "oanda");
          });
          chart.onIntervalChanged().subscribe(null, (res: ResolutionString) => {
            if (pushSyncRef.current) return;
            clearLatestCandle();
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
      studyManagerRef.current = null;
      headerButtonsRef.current.clear();
      try {
        widgetRef.current?.remove();
      } catch {
        /* ignore */
      }
      widgetRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- locale is the one
    // dependency that must retrigger; everything else syncs into the live widget.
  }, [locale]);

  // React symbol/source → widget (broker symbols carry a broker-spelled case).
  useEffect(() => {
    const w = widgetRef.current;
    if (!w || !readyRef.current) return;
    try {
      const chart = w.activeChart();
      const current = chart.symbol();
      // Both sides normalised the same way, or a broker symbol compares
      // XAUUSDM against XAUUSDm forever and the chart resets on every tick.
      const currentBare = normalizeSymbolCase(
        current.includes(":") ? current.split(":").pop()! : current,
      );
      if (currentBare !== normalizeSymbolCase(symbol)) {
        clearLatestCandle();
        pushSyncRef.current = true;
        chart.setSymbol(normalizeSymbolCase(symbol), () => {
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
        clearLatestCandle();
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

  const applyDrawings = useCallback((opts?: { force?: boolean }) => {
    const mgr = managerRef.current;
    if (!mgr || !readyRef.current) return;
    const a = drawArgsRef.current;
    const combined = [...overlaysToDrawings(a.overlays), ...(a.drawings ?? [])];
    mgr.apply(
      combined,
      { recommendation: a.recommendation, targets: a.targets },
      { symbol: a.symbol, interval: a.interval },
      opts,
    );
  }, []);
  applyDrawingsRef.current = applyDrawings;

  // Content changed (new analysis / cleared) → redraw now.
  useEffect(() => {
    if (!ready) return;
    applyDrawings();
  }, [ready, drawings, overlays, recommendation, targets, applyDrawings]);

  // Agent indicators → native TV studies. The manager diffs by fingerprint, so
  // the 4s layout poll re-delivering the same list is a no-op (no flicker).
  useEffect(() => {
    if (!ready) return;
    try {
      studyManagerRef.current?.apply(studies ?? []);
    } catch {
      /* widget mid-teardown — next apply reconciles */
    }
  }, [ready, studies]);

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

  // Theme and header direction can change without remounting the widget, so
  // drawings and the user's current chart state remain intact.
  useEffect(() => {
    const w = widgetRef.current;
    if (w && readyRef.current) {
      void w.changeTheme(theme).then(() => {
        w.applyOverrides({
          "paneProperties.background": embedRef.current
            ? "rgba(0,0,0,0)"
            : theme === "dark"
              ? "#050505"
              : "#f4f5f7",
          "paneProperties.backgroundType": "solid",
          "paneProperties.legendProperties.showSeriesTitle": false,
        });
      }).catch(() => {});
    }
    for (const el of headerButtonsRef.current.values()) {
      el.dir = directionRef.current;
      el.style.direction = directionRef.current;
    }
  }, [theme, direction, ready]);

  // TradingView sizes its canvas on window resize, not on container or
  // visualViewport changes. After idle, tab restore, or the mobile sheet
  // growing to the top of the screen, the candles would sit above a gap
  // unless we re-notify the widget.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !ready) return;
    let raf = 0;
    const notify = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        window.dispatchEvent(new Event("resize"));
      });
    };
    const ro = new ResizeObserver(notify);
    ro.observe(el);
    const onVisible = () => {
      if (document.visibilityState === "visible") notify();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", notify);
    window.addEventListener("aichart:app-wake", notify);
    window.addEventListener("online", notify);
    window.visualViewport?.addEventListener("resize", notify);
    window.visualViewport?.addEventListener("scroll", notify);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", notify);
      window.removeEventListener("aichart:app-wake", notify);
      window.removeEventListener("online", notify);
      window.visualViewport?.removeEventListener("resize", notify);
      window.visualViewport?.removeEventListener("scroll", notify);
    };
  }, [ready]);

  return (
    <div dir={direction} className={cn("relative h-full w-full", className)}>
      <div
        ref={containerRef}
        data-symbol={symbol}
        data-tv-chart
        className="h-full w-full"
      />
      <ChartScanOverlay active={analyzing} />
    </div>
  );
});

export default TvChart;
