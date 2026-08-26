"use client";

import type { MarketDataSource } from "@/lib/markets/marketDataSource";
import { normalizeSymbolCase } from "@/lib/markets/symbolCase";
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import type { TvChartHandle, TvHeaderAction } from "@/components/chart/TvChart";
import { useSheetSlot } from "@/components/shell/SheetCoordinator";
import { CHART_RELOAD_EVENT, CHART_TOGGLE_EVENT } from "@/components/shell/ConsoleTopBar";
import { useConsoleChatUrl } from "@/hooks/useConsoleChatUrl";
import { useSheetGesture } from "@/hooks/useSheetGesture";

function ChartLoading() {
  const { t } = useLocale();
  return (
    <div className="flex h-full min-h-[200px] items-center justify-center text-sm text-muted-foreground">
      {t("layout.loading_chart")}
    </div>
  );
}

const TvChart = dynamic(() => import("@/components/chart/TvChart"), {
  ssr: false,
  loading: () => <ChartLoading />,
});

import { ChartErrorBoundary } from "@/components/chart/ChartErrorBoundary";
import { ChartTradeOverlay } from "@/components/chart/ChartTradeOverlay";
import {
  SmartChartAgentPanel,
  type SmartChartAgentHandle,
} from "@/components/agent/SmartChartAgentPanel";
import { useChatSessions } from "@/hooks/useChatSessions";
import { useMe } from "@/hooks/useMe";
import { useLocale } from "@/hooks/useLocale";
import { useTheme } from "@/components/ThemeProvider";
import {
  DEFAULT_DESKTOP_LAYOUT,
  loadChatWidth,
  loadDesktopLayout,
  saveDesktopLayout,
  type DesktopLayout,
} from "@/lib/layout/chatLayout";
import { useChartAnalysis, type ChartHydrateSnapshot } from "@/hooks/useChartAnalysis";
import { prefetchKlines } from "@/lib/ohlc/klinesClientCache";
import { fetchWithTimeout } from "@/lib/fetchWithTimeout";
import { normalizeInterval } from "@/lib/intervals";
import { clearAgentDrawings } from "@/lib/agent/drawings/drawingOwnership";
import {
  debugBridgeEnabled,
  installAgentDebugBridge,
  removeAgentDebugBridge,
  publicFinalResult,
} from "@/lib/debug/agentDebugBridge";
import type { AgentFinalResult } from "@/lib/agent/types";
import { withStableCreatedAt } from "@/lib/recommendations/anchorTime";
import type { Recommendation } from "@/lib/types";
import type { MarketType } from "@/lib/markets/types";

const LS_SYMBOL = "aichart_last_symbol";
const LS_INTERVAL = "aichart_last_interval";
const DEFAULT_SYMBOL = "XAUUSD";

/** Persisted layout state (drawings + recommendation) for refresh survival. */
export interface ChartLayoutState extends ChartHydrateSnapshot {
  targets?: number[];
  /** Candle source for the active symbol: the platform OANDA feed. */
  dataSource?: MarketDataSource;
}

export function SmartChartWorkspace(props: {
  recommendations?: Recommendation[];
  agentReady?: boolean;
  /** Guest (not signed in): browse chart only; tools redirect to login. */
  guest?: boolean;
  /** Symbol from the URL — takes precedence over last-used. */
  initialSymbol?: string;
  /** Per-user chart layout id (TradingView-style /chart/<id> URL). */
  layoutId?: string;
  initialInterval?: string;
  /** Saved drawings/recommendation restored on load (no re-analysis). */
  initialState?: ChartLayoutState | null;
  /**
   * Headless screenshot render. The layout poll and autosave are suspended:
   * during a capture they would pull the SAVED symbol/interval back over the
   * requested one — the screenshot must show what was asked for, and must not
   * write the capture's transient state back to the operator's layout.
   */
  capture?: boolean;
}) {
  return (
    <Suspense fallback={<ChartLoading />}>
      <SmartChartWorkspaceInner {...props} />
    </Suspense>
  );
}

function SmartChartWorkspaceInner({
  recommendations = [],
  agentReady = true,
  guest = false,
  initialSymbol,
  layoutId,
  initialInterval,
  initialState,
  capture = false,
}: {
  recommendations?: Recommendation[];
  agentReady?: boolean;
  /** Guest (not signed in): browse chart only; tools redirect to login. */
  guest?: boolean;
  /** Symbol from the URL — takes precedence over last-used. */
  initialSymbol?: string;
  /** Per-user chart layout id (TradingView-style /chart/<id> URL). */
  layoutId?: string;
  initialInterval?: string;
  /** Saved drawings/recommendation restored on load (no re-analysis). */
  initialState?: ChartLayoutState | null;
  /** Headless screenshot render — see the wrapper's doc comment. */
  capture?: boolean;
}) {
  const chartRef = useRef<TvChartHandle>(null);
  const agentRef = useRef<SmartChartAgentHandle>(null);
  // Last final agent result — surfaced read-only via the dev/test debug bridge.
  const lastFinalResultRef = useRef<AgentFinalResult | null>(null);
  /**
   * Below `xl` the chart is a sheet the operator pulls up over the
   * conversation; from `xl` it is a pane beside it. One piece of state per
   * regime, because "is the chart showing" means different things at each size.
   */
  const [chartSheetOpen, setChartSheetOpen] = useSheetSlot("chart");
  const [desktopLayout, setDesktopLayout] = useState<DesktopLayout>(
    DEFAULT_DESKTOP_LAYOUT,
  );
  /**
   * The sheet's resting height leaves the top bar visible; a pull past it grows
   * the chart to the full viewport for reading dense candles, and a pull down
   * dismisses. Collapses with the sheet so every open starts at rest.
   */
  const [sheetExpanded, setSheetExpanded] = useState(false);
  useEffect(() => {
    if (!chartSheetOpen) setSheetExpanded(false);
  }, [chartSheetOpen]);
  /**
   * Below `xl` the chart is a bottom sheet. `100dvh` / `88dvh` drift after
   * idle, tab restore, or the mobile chrome showing/hiding — size the sheet
   * from the visual viewport instead so candles fill the pane.
   */
  const [isWide, setIsWide] = useState(false);
  const [viewportHeight, setViewportHeight] = useState<number | null>(null);
  useEffect(() => {
    const query = window.matchMedia("(min-width: 1280px)");
    const syncWide = () => setIsWide(query.matches);
    syncWide();
    query.addEventListener("change", syncWide);
    const syncHeight = () => {
      setViewportHeight(window.visualViewport?.height ?? window.innerHeight);
    };
    syncHeight();
    window.visualViewport?.addEventListener("resize", syncHeight);
    window.visualViewport?.addEventListener("scroll", syncHeight);
    window.addEventListener("resize", syncHeight);
    window.addEventListener("pageshow", syncHeight);
    document.addEventListener("visibilitychange", syncHeight);
    return () => {
      query.removeEventListener("change", syncWide);
      window.visualViewport?.removeEventListener("resize", syncHeight);
      window.visualViewport?.removeEventListener("scroll", syncHeight);
      window.removeEventListener("resize", syncHeight);
      window.removeEventListener("pageshow", syncHeight);
      document.removeEventListener("visibilitychange", syncHeight);
    };
  }, []);
  const sheetPaneRef = useRef<HTMLDivElement>(null);
  const { handleProps: sheetHandleProps } = useSheetGesture({
    sheetRef: sheetPaneRef,
    onDismiss: () => setChartSheetOpen(false),
    expandable: true,
    expanded: sheetExpanded,
    onExpandedChange: setSheetExpanded,
  });
  // A capture renders the chart alone. Leaving chat on also left its URL sync
  // on, which rewrote the address to /workspace mid-load — so the screenshot
  // was of the workspace at the SAVED timeframe, not the requested chart.
  const chatEnabled = !guest && !capture;

  const { locale, t, dir } = useLocale();
  const { resolved: chartTheme } = useTheme();
  const router = useRouter();

  // Desktop chat-panel width. Fixed — dragging the split is disabled.
  const [chatWidth] = useState<number>(() => loadChatWidth());

  // Read after mount so the server and first client render agree.
  useEffect(() => setDesktopLayout(loadDesktopLayout()), []);

  const applyDesktopLayout = useCallback((next: DesktopLayout) => {
    setDesktopLayout(next);
    saveDesktopLayout(next);
  }, []);

  const market: MarketType = "forex";

  const [symbol, setSymbol] = useState(() => {
    if (initialSymbol) return normalizeSymbolCase(initialSymbol);
    if (typeof window === "undefined") return DEFAULT_SYMBOL;
    /*
     * Normalised on the way OUT of storage, not just on the way in. A symbol
     * cached before the case-preservation fix — or written by any future path
     * that still folds case — sits in localStorage forever otherwise: this is
     * the one read every returning browser hits before any picker interaction
     * corrects it, and the quote for the wrong-case spelling simply
     * fails silently (cloudQuote's catch surfaced no error). That is what an
     * uppercased "XAUUSDM" leftover from an earlier session looked like: a
     * blank spread badge because the feed never recognised the spelling.
     */
    return normalizeSymbolCase(localStorage.getItem(LS_SYMBOL) ?? DEFAULT_SYMBOL);
  });

  const [interval, setChartInterval] = useState(() => {
    if (initialInterval) return normalizeInterval(initialInterval);
    if (typeof window === "undefined") return "15m";
    return localStorage.getItem(LS_INTERVAL) ?? "15m";
  });

  const [dataSource, setDataSource] = useState<MarketDataSource>("oanda");

  const [creditsRemaining, setCreditsRemaining] = useState<number | null>(null);


  const hydrateSnapshot = useMemo<ChartHydrateSnapshot | null>(
    () => (initialState ? initialState : null),
    [initialState],
  );

  const {
    isAnalyzing,
    overlays,
    drawings,
    studies,
    recommendation,
    targets,
    riskReward,
    liveAnalysis,
    analyzeError,
    liveReasoningLog,
    clearLayers,
    stopLiveAnalysis,
    setHighlightDrawingIndex,
    hydrateFromSnapshot,
    setDrawings,
    setStudies,
    setRecommendation,
  } = useChartAnalysis({
    symbol,
    interval,
    market,
    dataSource,
    hydrateSnapshot,
  });

  const refreshCredits = useCallback(async () => {
    try {
      const res = await fetch("/api/me", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as {
        quota?: { remaining?: number; limit?: number };
      };
      const remaining = data.quota?.remaining;
      if (remaining != null) setCreditsRemaining(remaining);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (guest) return;
    void refreshCredits();
  }, [refreshCredits, guest]);

  // The open-trades badge polled /api/console/trades-active every 30 seconds.
  // The route is gone with the execution layer and the platform holds no
  // positions, so the poll asked a deleted endpoint how many trades were open
  // and rendered the answer as zero forever.

  useEffect(() => {
    localStorage.setItem(LS_SYMBOL, symbol);
  }, [symbol]);

  useEffect(() => {
    localStorage.setItem(LS_INTERVAL, interval);
  }, [interval]);

  // TradingView-style URLs: /chart/<layoutId>?symbol=X for signed-in users,
  // /chart/<SYMBOL> for guests. replaceState only — no page reload.
  useEffect(() => {
    if (typeof window === "undefined" || !symbol) return;
    if (!window.location.pathname.startsWith("/chart/")) return;
    const src = "";
    const target = layoutId
      ? `/chart/${layoutId}?symbol=${encodeURIComponent(symbol)}${src}`
      : `/chart/${encodeURIComponent(symbol)}`;
    const current = window.location.pathname + window.location.search;
    if (current !== target) window.history.replaceState(null, "", target);
  }, [symbol, layoutId, dataSource]);

  // Autosave the layout (drawings + recommendation) so refresh restores it.
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // updated_at cursor: lets the live-refresh poll tell "my own save" apart
  // from a remote (MCP/agent) write. savePendingRef guards the race window.
  const layoutCursorRef = useRef<string | null>(null);
  const savePendingRef = useRef(false);
  useEffect(() => {
    // A capture is a read-only render of someone's chart; writing its
    // transient symbol/interval back would corrupt the operator's saved layout.
    if (guest || !layoutId || capture) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    savePendingRef.current = true;
    saveTimerRef.current = setTimeout(() => {
      const state: ChartLayoutState = {
        drawings,
        overlays,
        studies,
        recommendation,
        targets,
        liveReasoningLog,
        dataSource,
      };
      void fetch("/api/chart/layout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: layoutId, symbol, interval, state }),
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { updated_at?: string | null } | null) => {
          if (d?.updated_at) layoutCursorRef.current = d.updated_at;
        })
        .catch(() => {})
        .finally(() => {
          savePendingRef.current = false;
        });
    }, 1200);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [
    guest,
    layoutId,
    capture,
    symbol,
    interval,
    dataSource,
    drawings,
    overlays,
    studies,
    recommendation,
    targets,
    liveReasoningLog,
  ]);

  // Live refresh: an AI assistant (MCP) can draw on this chart server-side —
  // poll the layout every 4s (visible tab only) and hydrate remote changes so
  // drawings appear without a reload. Skips while a local save/analysis is
  // in flight to avoid clobbering fresher local state.
  useEffect(() => {
    // During a capture the poll would yank symbol/interval back to the SAVED
    // layout mid-screenshot — the requested frame would never be photographed.
    if (guest || !layoutId || capture) return;
    let stopped = false;

    const tick = async () => {
      if (stopped) return;
      if (document.visibilityState !== "visible") return;
      if (savePendingRef.current || isAnalyzing) return;
      try {
        const res = await fetchWithTimeout(`/api/chart/layout?id=${layoutId}`, {
          cache: "no-store",
          timeoutMs: 6_000,
        });
        if (!res.ok) return;
        const d = (await res.json()) as {
          symbol?: string;
          interval?: string;
          updated_at?: string | null;
          state?: ChartLayoutState | null;
        };
        if (stopped || !d.updated_at) return;
        if (layoutCursorRef.current === null) {
          layoutCursorRef.current = d.updated_at;
          return;
        }
        if (d.updated_at === layoutCursorRef.current) return;
        // Order the timestamps instead of comparing for inequality: a poll that
        // started before our own save landed returns an OLDER updated_at, and
        // treating it as a "remote change" hydrated stale state, rolled the
        // cursor back, and flip-flopped the chart (visible as drawings jumping).
        const seen = Date.parse(layoutCursorRef.current ?? "");
        const incoming = Date.parse(d.updated_at);
        if (Number.isFinite(seen) && Number.isFinite(incoming) && incoming <= seen) return;
        // Remote change (MCP draw / analysis finished elsewhere) — hydrate.
        layoutCursorRef.current = d.updated_at;
        if (savePendingRef.current) return;
        if (d.state) {
          hydrateFromSnapshot(d.state);
        }
        if (d.symbol && d.symbol !== symbol) setSymbol(normalizeSymbolCase(d.symbol));
        if (d.interval && d.interval !== interval) {
          setChartInterval(normalizeInterval(d.interval));
        }
      } catch {
        /* transient — next tick */
      }
    };

    const t = window.setInterval(() => void tick(), 4000);
    return () => {
      stopped = true;
      window.clearInterval(t);
    };
  }, [guest, layoutId, capture, isAnalyzing, symbol, interval, hydrateFromSnapshot]);

  // Live-capture RPC: the server asks this tab to photograph the rendered
  // TradingView widget (drawings and studies included) and POST the PNG.
  // Same HTTP-poll family as layout refresh — not a new transport.
  useEffect(() => {
    if (guest || !layoutId || capture) return;
    let stopped = false;
    let busy = false;

    const processOne = async (request: {
      id: string;
      includeDrawings?: boolean;
      includeStudies?: boolean;
      symbol?: string;
      interval?: string;
      shots?: { label: string; candles: number }[];
    }) => {
      const ack = await fetch("/api/chart/live-capture", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "ack",
          request_id: request.id,
          layout_id: layoutId,
        }),
      });
      if (!ack.ok) return;
      const shot = await chartRef.current?.captureSnapshot({
        includeDrawings: request.includeDrawings !== false,
        includeStudies: request.includeStudies !== false,
        symbol: request.symbol,
        interval: request.interval,
        // The server names both windows of the two-shot pair; the tab obeys.
        shots: request.shots,
      });
      if (!shot) return;
      await fetch("/api/chart/live-capture", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "upload",
          request_id: request.id,
          layout_id: layoutId,
          images: shot.images.map((image) => ({
            label: image.label,
            image_base64: image.pngBase64,
          })),
          drawings_rendered: shot.drawingsRendered,
          studies_rendered: shot.studiesRendered,
        }),
      });
    };

    const tick = async () => {
      if (stopped || busy) return;
      busy = true;
      try {
        const res = await fetch(`/api/chart/live-capture?layout_id=${layoutId}`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = (await res.json()) as {
          requests?: Array<{
            id: string;
            includeDrawings?: boolean;
            includeStudies?: boolean;
            symbol?: string;
            interval?: string;
            shots?: { label: string; candles: number }[];
          }>;
        };
        for (const request of data.requests ?? []) {
          if (stopped) break;
          await processOne(request);
        }
      } catch {
        /* transient — next tick */
      } finally {
        busy = false;
      }
    };

    const t = window.setInterval(() => void tick(), 400);
    void tick();
    return () => {
      stopped = true;
      window.clearInterval(t);
    };
  }, [guest, layoutId, capture]);

  useEffect(() => {
    prefetchKlines(symbol, interval, market);
  }, [symbol, interval, market]);

  const handleSymbolChange = useCallback((s: string, source: MarketDataSource = "oanda") => {
    setSymbol(normalizeSymbolCase(s));
    setDataSource(source);
  }, []);

  const handleIntervalChange = useCallback((iv: string) => {
    setChartInterval(normalizeInterval(iv));
  }, []);

  const handleClearLayers = useCallback(() => {
    clearLayers();
    stopLiveAnalysis();
  }, [clearLayers, stopLiveAnalysis]);

  // Apply the agent's drawings to the chart: keep user/manual drawings, replace
  // only the agent-owned set (one coherent set of drawings on the chart).
  const handleAgentResult = useCallback(
    (result: AgentFinalResult) => {
      lastFinalResultRef.current = result;
      // Empty `drawings: []` is truthy and used to mean "no new drawings" on
      // many paths — applying it wiped agent overlays. Clear only on an
      // explicit clear flag; otherwise replace agent layers only when new ones arrive.
      if (result.clearAgentDrawings) {
        setDrawings((prev) => clearAgentDrawings(prev));
      } else if (result.drawings?.length) {
        setDrawings((prev) =>
          [...clearAgentDrawings(prev), ...(result.drawings ?? [])],
        );
      }
      // Indicators from the SSE path: merge by id so "add MACD" keeps the RSI
      // the agent enabled earlier instead of replacing the whole set.
      if (result.studies?.length) {
        const incoming = result.studies;
        setStudies((prev) => {
          const replaced = new Set(incoming.map((s) => s.id));
          return [...prev.filter((s) => !replaced.has(s.id)), ...incoming];
        });
      }
      const rec = result.recommendation;
      if (rec && (rec.action === "buy" || rec.action === "sell")) {
        // withStableCreatedAt: the chart anchors the profit/loss zones at this
        // recommendation's created_at. Stamped ONCE here (or inherited when the
        // same plan is re-delivered), then persisted via the layout autosave —
        // without it the zones re-anchor to "now" on every redraw and reload,
        // sliding along with the latest candle.
        setRecommendation((prev) =>
          withStableCreatedAt(
            {
              symbol,
              action: rec.action,
              entryType: rec.entryType,
              entry: rec.entry ?? null,
              stop_loss: rec.stop_loss ?? null,
              take_profit: rec.take_profit ?? rec.targets?.[0] ?? null,
              confidence: Math.round(result.confidence * 100),
              timeframe: interval,
            } as Recommendation,
            prev,
          ),
        );
      } else if (result.decision === "wait") {
        setRecommendation(null);
      }
    },
    [setDrawings, setStudies, setRecommendation, symbol, interval],
  );

  // Analyze always uses the same chat agent path; there is no parallel engine.
  const handleAnalyzeClick = useCallback(() => {
    if (guest) {
      router.push("/login?next=/chart");
      return;
    }
    setChartSheetOpen(false);
    // Defer so the panel mounts before the imperative call.
    setTimeout(() => agentRef.current?.quickAnalyze(), 0);
  }, [guest, router]);

  const hasLayers =
    drawings.length > 0 || overlays.length > 0 || recommendation != null;

  // Platform actions as TradingView header buttons (library chrome — not overlays).
  // MT status / equity / close-chart live in the page top bar; do not re-draw them.
  const headerActions = useMemo<TvHeaderAction[]>(() => {
    if (chatEnabled) return [];
    const analyzeAction: TvHeaderAction = {
      id: "analyze",
      text: guest
        ? t("layout.sign_in_to_analyze")
        : isAnalyzing
          ? t("layout.analyzing")
          : creditsRemaining != null
            ? t("layout.analyze_credits", { count: String(creditsRemaining) })
            : t("layout.analyze"),
      title: guest
        ? t("layout.sign_in_analysis_title")
        : t("layout.ai_analysis"),
      color: "#71717a",
      onClick: handleAnalyzeClick,
    };
    const clearAction: TvHeaderAction[] =
      !guest && hasLayers
        ? [
            {
              id: "clear",
              text: t("layout.clear_drawings"),
              title: t("layout.clear_drawings_title"),
              onClick: handleClearLayers,
            },
          ]
        : [];
    // The "open trades" header button is gone with the execution layer. It
    // opened a drawer that no longer exists — `tradesOpen` was set and never
    // read — and its badge counted positions this platform does not hold.
    return [analyzeAction, ...clearAction];
  }, [
    chatEnabled,
    t,
    guest,
    isAnalyzing,
    creditsRemaining,
    hasLayers,
    handleAnalyzeClick,
    handleClearLayers,
  ]);

  const { urlChatId, syncChatUrl } = useConsoleChatUrl({ enabled: chatEnabled });

  const chat = useChatSessions({
    enabled: chatEnabled,
    symbol,
    interval,
    locale,
    urlChatId,
    syncChatUrl,
  });

  const didInitialUrlSync = useRef(false);
  const lastUrlChatId = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    if (!chatEnabled || !chat.ready || !chat.activeChatId || didInitialUrlSync.current) return;
    didInitialUrlSync.current = true;
    if (urlChatId !== chat.activeChatId) {
      syncChatUrl(chat.activeChatId, "replace");
    }
  }, [chatEnabled, chat.ready, chat.activeChatId, urlChatId, syncChatUrl]);

  useEffect(() => {
    if (!chatEnabled || !chat.ready) return;
    if (lastUrlChatId.current === urlChatId) return;
    lastUrlChatId.current = urlChatId;
    if (urlChatId && urlChatId !== chat.activeChatId) {
      chat.selectChat(urlChatId, { skipUrlSync: true });
      setChartSheetOpen(false);
    }
  }, [chatEnabled, chat.ready, urlChatId, chat.activeChatId, chat.selectChat]);

  /**
   * Escape lowers the sheet. It is a CSS-positioned pane rather than a dialog
   * primitive, so nothing gave it that for free — and with the sheet covering
   * the composer, a keyboard user had no way out but the mouse.
   */
  useEffect(() => {
    if (!chartSheetOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setChartSheetOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [chartSheetOpen, setChartSheetOpen]);

  // The top bar's refresh control, for traders: reload the candles, not the page.
  useEffect(() => {
    const reload = () => chartRef.current?.reload();
    window.addEventListener(CHART_RELOAD_EVENT, reload);
    return () => window.removeEventListener(CHART_RELOAD_EVENT, reload);
  }, []);

  useEffect(() => {
    const create = () => {
      void chat.newChat();
      setChartSheetOpen(false);
    };
    window.addEventListener("aichart:new-chat", create);
    return () => window.removeEventListener("aichart:new-chat", create);
  }, [chat.newChat]);


  // Dev/test-only read-only debug bridge for Playwright UI-sync assertions.
  // Refreshes each render so the getter closes over the latest values; never
  // exposes secrets, tokens, audio, or provider payloads. No-op in production.
  useEffect(() => {
    if (!debugBridgeEnabled()) return;
    installAgentDebugBridge(() => {
      const candle = chartRef.current?.latestCandle() ?? null;
      const userDrawings = chartRef.current?.getUserDrawings() ?? [];
      return {
        symbol,
        interval,
        latestChartCandleTime: candle?.time ?? null,
        latestChartClose: candle?.close ?? null,
        visibleRange: chartRef.current?.visibleRange() ?? null,
        agentDrawingCount: drawings.length,
        userDrawingCount: userDrawings.length,
        drawingCount: drawings.length + userDrawings.length,
        activeRecommendation: recommendation
          ? {
              action: recommendation.action,
              entry: recommendation.entry ?? null,
              stop_loss: recommendation.stop_loss ?? null,
              take_profit: recommendation.take_profit ?? null,
            }
          : null,
        activeChatId: chat.activeChatId ?? null,
        locale,
        chartSheetOpen,
        desktopLayout,
        lastFinalResult: publicFinalResult(lastFinalResultRef.current),
      };
    });
    return () => removeAgentDebugBridge();
  });

  /**
   * The chart node is never unmounted — symbol and interval changes are pushed
   * into the live widget, and a remount would throw away every drawing on it. So
   * every layout below is expressed as CSS on one persistent element.
   *
   * Under `xl` it is a sheet: fixed to the bottom edge, over the composer
   * rather than above it — while the chart is up it owns the screen, and the
   * composer sits behind it instead of floating on top of the candles. Closed,
   * it is translated fully off-screen. From `xl` it snaps back into the flex row
   * as an ordinary pane.
   */
  const chartVisibleDesktop = !chatEnabled || desktopLayout !== "chatOnly";
  const sheetHeightPx =
    !isWide && chatEnabled && viewportHeight != null
      ? Math.round(sheetExpanded ? viewportHeight : viewportHeight * 0.88)
      : null;
  const chartPaneClass = cn(
    "relative flex min-h-0 flex-col overflow-hidden bg-background",
    chatEnabled && [
      sheetExpanded
        ? "fixed inset-x-0 bottom-0 z-40 h-[100dvh]"
        : "fixed inset-x-0 bottom-0 z-40 h-[88dvh]",
      "rounded-t-[var(--radius-lg)] border-t border-border shadow-2xl",
      "transition-[transform,height] duration-300 ease-out motion-reduce:transition-none",
      chartSheetOpen
        ? "translate-y-0"
        : "invisible translate-y-full",
      // From xl it is a pane again: no fixed positioning, no transform.
      "xl:visible xl:static xl:inset-auto xl:z-auto xl:h-auto xl:flex-1",
      "xl:translate-y-0 xl:rounded-none xl:border-t-0 xl:shadow-none xl:transition-none",
      chartVisibleDesktop ? "xl:flex" : "xl:hidden",
    ],
    !chatEnabled && "flex-1",
  );
  // Chat: full width up to xl, persisted width beside the chart from xl.
  const chatPaneClass = cn(
    "flex h-full min-h-0 w-full flex-col border-border/40",
    desktopLayout === "chartOnly"
      ? "xl:hidden"
      : desktopLayout === "chatOnly"
        ? "xl:w-full"
        : "xl:w-[var(--chat-w)] xl:shrink-0",
  );

  /**
   * One control in the composer, two meanings by width: under `xl` it raises and
   * lowers the sheet, from `xl` it puts the chart pane beside the conversation
   * or gives the width back. Both regimes are tracked so the button's pressed
   * state matches whichever one the operator is actually looking at.
   */
  const toggleChart = useCallback(() => {
    if (isWide) {
      applyDesktopLayout(desktopLayout === "chatOnly" ? "split" : "chatOnly");
      return;
    }
    setChartSheetOpen(!chartSheetOpen);
  }, [isWide, desktopLayout, applyDesktopLayout, chartSheetOpen, setChartSheetOpen]);

  // The chart toggle moved to the top bar; the workspace still owns the state.
  // A ref keeps the window listener stable while `toggleChart` re-derives.
  const toggleChartRef = useRef<() => void>(() => {});
  useEffect(() => {
    toggleChartRef.current = toggleChart;
  });
  useEffect(() => {
    const toggle = () => toggleChartRef.current();
    window.addEventListener(CHART_TOGGLE_EVENT, toggle);
    return () => window.removeEventListener(CHART_TOGGLE_EVENT, toggle);
  }, []);


  return (
    <div className="relative flex h-full min-h-0 flex-col">
      {!guest && !agentReady && (
        <p className="pointer-events-none absolute inset-x-0 top-12 z-40 mx-auto w-fit max-w-[90%] rounded-md border border-warning/30 bg-warning/90 px-3 py-1 text-xs text-black shadow">
          {t("layout.agent_unavailable")}
        </p>
      )}

      {analyzeError && (
        <p className="pointer-events-none absolute inset-x-0 top-12 z-40 mx-auto w-fit max-w-[90%] rounded-md border border-destructive/30 bg-destructive/90 px-3 py-1 text-xs text-destructive-foreground shadow">
          {analyzeError}
        </p>
      )}

      {/* Dismiss layer for the chart sheet. Under xl only — from xl the chart is
          a pane and has nothing to dismiss. */}
      {chatEnabled && chartSheetOpen && (
        <button
          type="button"
          aria-label={t("layout.close_chart")}
          onClick={() => setChartSheetOpen(false)}
          className="fixed inset-0 z-30 bg-black/50 transition-opacity duration-250 xl:hidden motion-reduce:transition-none"
        />
      )}

      <div
        className="flex min-h-0 flex-1 overflow-hidden"
        dir="ltr"
        style={{ "--chat-w": `${chatWidth}px` } as CSSProperties}
      >
        <div
          ref={sheetPaneRef}
          data-chart-pane
          data-testid="workspace-chart-pane"
          data-expanded={sheetExpanded || undefined}
          className={chartPaneClass}
          style={sheetHeightPx != null ? { height: `${sheetHeightPx}px` } : undefined}
          onTransitionEnd={(event) => {
            if (event.propertyName !== "height" && event.propertyName !== "transform") return;
            window.dispatchEvent(new Event("resize"));
          }}
        >
          {/* Grab bar: the sheet's drag handle under xl, and the surface that
              carries its dismiss affordance. Hidden once the chart is a pane. */}
          {chatEnabled && (
            <div
              {...sheetHandleProps}
              data-testid="chart-sheet-handle"
              className="flex h-11 shrink-0 cursor-grab items-center justify-center active:cursor-grabbing xl:hidden"
            >
              <span aria-hidden className="h-1 w-10 rounded-full bg-muted-foreground/40" />
            </div>
          )}
          <div className="relative min-h-0 flex-1 overflow-hidden">
            {/* Static key: symbol/interval changes sync INSIDE the widget (setSymbol/
                setResolution) — never remount, so drawings and chart state survive. */}
            <ChartErrorBoundary key="tv">
              <TvChart
                ref={chartRef}
                symbol={symbol}
                interval={interval}
                market={market}
                analyzing={isAnalyzing}
                recommendation={recommendation}
                targets={targets}
                overlays={overlays}
                drawings={drawings}
                studies={studies}
                headerActions={headerActions}
                dataSource={dataSource}
                locale={locale}
                direction={dir}
                theme={chartTheme}
                capture={capture}
                className="h-full min-h-0 w-full"
                onSymbolChange={handleSymbolChange}
                onIntervalChange={handleIntervalChange}
              />
            </ChartErrorBoundary>

            {!chatEnabled && !capture && headerActions.length > 0 && (
              <div className="pointer-events-none absolute inset-x-0 top-2 z-20 flex justify-end px-2">
                <div className="pointer-events-auto flex flex-wrap justify-end gap-1">
                  {/* eslint-disable-next-line react-hooks/refs -- false positive:
                      the map only forwards action.onClick as a prop; the ref
                      inside handleAnalyzeClick is read in a deferred event
                      handler, never during render. */}
                  {headerActions.map((action) => (
                    <button
                      key={action.id}
                      type="button"
                      title={action.title}
                      onClick={action.onClick}
                      className="rounded-lg border border-border/60 bg-background/90 px-2 py-1 text-xs font-semibold text-muted-foreground shadow-sm backdrop-blur-md hover:bg-muted hover:text-foreground"
                    >
                      {action.text}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <ChartTradeOverlay
              recommendation={recommendation}
              targets={targets}
              riskReward={riskReward}
              liveReasoningLog={liveReasoningLog}
              isAnalyzing={isAnalyzing}
              liveAnalysis={liveAnalysis}
              drawings={drawings}
              onHighlightDrawing={setHighlightDrawingIndex}
              onStopLive={stopLiveAnalysis}
            />
          </div>

        </div>

        {chatEnabled && (
          <div
            aria-hidden
            className={cn(
              "pointer-events-none hidden w-px shrink-0 bg-border/50",
              desktopLayout === "split" && "xl:block",
            )}
          />
        )}

        {chatEnabled && (
          <div className={chatPaneClass}>
            {/* Mode / account state live in the top bar (N18). Execution stage
                remains in the composer + menu — not as a row above the chat. */}
            <SmartChartAgentPanel
              key={chat.panelKey}
              ref={agentRef}
              symbol={symbol}
              interval={interval}
              layoutId={layoutId}
              dataSource={dataSource}
              chatId={chat.activeChatId ?? undefined}
              initialMessages={chat.activeMessages}
              hydrating={chat.loadingMessages}
              getVisibleRange={() => chartRef.current?.visibleRange() ?? undefined}
              getLatestCandle={() => chartRef.current?.latestCandle() ?? undefined}
              getDrawings={() => drawings}
              getUserDrawings={() => chartRef.current?.getUserDrawings() ?? undefined}
              getSelectedDrawingId={() =>
                chartRef.current?.getSelectedUserDrawingId() ?? undefined
              }
              applyDrawingMutations={(commands) =>
                chartRef.current?.applyUserDrawingMutations(commands)
              }
              getRecommendation={() =>
                recommendation
                  ? {
                      action: recommendation.action,
                      entryType: recommendation.entryType,
                      entry: recommendation.entry ?? undefined,
                      stop_loss: recommendation.stop_loss ?? undefined,
                      take_profit: recommendation.take_profit ?? undefined,
                      targets,
                    }
                  : undefined
              }
              onSymbolChange={handleSymbolChange}
              onIntervalChange={handleIntervalChange}
              onResult={handleAgentResult}
              onPersistMessage={chat.persistMessage}
              ensureChatId={chat.ensureChat}
            />
          </div>
        )}
      </div>


    </div>
  );
}
