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
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
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
import { OpenTradesDrawer } from "@/components/chart/OpenTradesDrawer";
import {
  SmartChartAgentPanel,
  type SmartChartAgentHandle,
} from "@/components/agent/SmartChartAgentPanel";
import { AgentVoiceButton } from "@/components/agent/AgentVoiceButton";
import { AgentVoicePanel } from "@/components/agent/AgentVoicePanel";
import { useChatSessions } from "@/hooks/useChatSessions";
import { useAgentVoiceSession } from "@/hooks/useAgentVoiceSession";
import { useMe } from "@/hooks/useMe";
import { useLocale } from "@/hooks/useLocale";
import { useTheme } from "@/components/ThemeProvider";
import {
  DEFAULT_DESKTOP_LAYOUT,
  MAX_CHAT_WIDTH,
  MIN_CHAT_WIDTH,
  clampChatWidth,
  loadChatWidth,
  loadDesktopLayout,
  saveChatWidth,
  saveDesktopLayout,
  type DesktopLayout,
} from "@/lib/layout/chatLayout";
import { useChartAnalysis, type ChartHydrateSnapshot } from "@/hooks/useChartAnalysis";
import { useAccountCapital } from "@/hooks/useAccountCapital";
import { prefetchKlines } from "@/lib/ohlc/klinesClientCache";
import { normalizeInterval } from "@/lib/intervals";
import { clearAgentDrawings } from "@/lib/agent/drawings/drawingOwnership";
import {
  debugBridgeEnabled,
  installAgentDebugBridge,
  removeAgentDebugBridge,
  publicFinalResult,
} from "@/lib/debug/agentDebugBridge";
import type { AgentFinalResult } from "@/lib/agent/types";
import type { Recommendation } from "@/lib/types";
import type { MarketType } from "@/lib/markets/types";

const LS_SYMBOL = "aichart_last_symbol";
const LS_INTERVAL = "aichart_last_interval";
const DEFAULT_SYMBOL = "XAUUSD";

/** Persisted layout state (drawings + recommendation) for refresh survival. */
export interface ChartLayoutState extends ChartHydrateSnapshot {
  targets?: number[];
  /** Candle source for the active symbol: OANDA or the user's linked broker. */
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

  // Desktop chat-panel width (persisted, clamped). Not used on mobile.
  const [chatWidth, setChatWidth] = useState<number>(() => loadChatWidth());

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
    return localStorage.getItem(LS_SYMBOL) ?? DEFAULT_SYMBOL;
  });

  const [interval, setChartInterval] = useState(() => {
    if (initialInterval) return normalizeInterval(initialInterval);
    if (typeof window === "undefined") return "15m";
    return localStorage.getItem(LS_INTERVAL) ?? "15m";
  });

  const [dataSource, setDataSource] = useState<MarketDataSource>("oanda");
  const [tradesOpen, setTradesOpen] = useState(false);
  const [openTradesCount, setOpenTradesCount] = useState(0);
  const [forexOnline, setForexOnline] = useState(false);
  const [creditsRemaining, setCreditsRemaining] = useState<number | null>(null);

  const capital = useAccountCapital(market);

  const hydrateSnapshot = useMemo<ChartHydrateSnapshot | null>(
    () => (initialState ? initialState : null),
    [initialState],
  );

  const {
    isAnalyzing,
    overlays,
    drawings,
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

  useEffect(() => {
    if (guest) return;
    void fetch("/api/console/status", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        setForexOnline(Boolean(d.mt5?.online));
      })
      .catch(() => {});
  }, [guest]);

  useEffect(() => {
    if (guest) return;
    const load = () =>
      void fetch("/api/console/trades-active", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { rows?: unknown[] } | null) => {
          setOpenTradesCount(Array.isArray(d?.rows) ? d!.rows!.length : 0);
        })
        .catch(() => {});
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [guest]);

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
        const res = await fetch(`/api/chart/layout?id=${layoutId}`, {
          cache: "no-store",
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
          if (d.state.dataSource === "oanda") {
            setDataSource("oanda");
          }
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
      if (result.drawings) {
        setDrawings((prev) =>
          [...clearAgentDrawings(prev), ...(result.drawings ?? [])],
        );
      }
      const rec = result.recommendation;
      if (rec && (rec.action === "buy" || rec.action === "sell")) {
        setRecommendation({
          symbol,
          action: rec.action,
          entryType: rec.entryType,
          entry: rec.entry ?? null,
          stop_loss: rec.stop_loss ?? null,
          take_profit: rec.take_profit ?? rec.targets?.[0] ?? null,
          confidence: Math.round(result.confidence * 100),
          timeframe: interval,
        } as Recommendation);
      } else if (result.decision === "wait") {
        setRecommendation(null);
      }
    },
    [setDrawings, setRecommendation, symbol, interval],
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
    const tradesAction: TvHeaderAction[] = !guest
      ? [
          {
            id: "trades",
            text:
              openTradesCount > 0
                ? t("layout.trades_count", { count: String(openTradesCount) })
                : t("layout.trades"),
            title: t("layout.open_trades"),
            onClick: () => setTradesOpen(true),
          },
        ]
      : [];
    return [analyzeAction, ...clearAction, ...tradesAction];
  }, [
    chatEnabled,
    t,
    guest,
    isAnalyzing,
    creditsRemaining,
    hasLayers,
    openTradesCount,
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

  // Live voice conversation. The realtime model is only the speech interface —
  // every final transcript is routed through the SAME agent flow as typed text
  // (agentRef.sendMessage with inputMode "voice"), and the agent's public final
  // answer is spoken back. Voice never bypasses the agent's authority.
  const me = useMe();
  const voice = useAgentVoiceSession({
    chatId: chat.activeChatId ?? undefined,
    locale,
    symbol,
    interval,
    userId: me.data?.user.id ?? 0,
    enabled: chatEnabled,
    sendAgentMessage: (text) =>
      agentRef.current?.sendMessage(text, { inputMode: "voice" }),
  });
  // Stop any live voice session when switching chats (rebind safely).
  useEffect(() => {
    if (voice.active) void voice.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.activeChatId]);

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
        voiceStatus: voice.status,
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
  const chartPaneClass = cn(
    "relative flex min-h-0 flex-col overflow-hidden bg-background",
    chatEnabled && [
      sheetExpanded ? "fixed inset-x-0 bottom-0 z-40 h-[100dvh]" : "fixed inset-x-0 bottom-0 z-40 h-[88dvh]",
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
    "flex min-h-0 w-full flex-col border-border/40",
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
  const [isWide, setIsWide] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(min-width: 1280px)");
    const sync = () => setIsWide(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

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


  // Desktop chat resize: chat is the right column, so dragging the handle left
  // widens it. Persists on release.
  const startChatResize = (e: ReactPointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = chatWidth;
    const onMove = (ev: PointerEvent) =>
      setChatWidth(clampChatWidth(startW + (startX - ev.clientX)));
    const onUp = (ev: PointerEvent) => {
      saveChatWidth(clampChatWidth(startW + (startX - ev.clientX)));
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const resizeChatWithKeyboard = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    let next: number | null = null;
    if (event.key === "ArrowLeft") next = chatWidth + 24;
    if (event.key === "ArrowRight") next = chatWidth - 24;
    if (event.key === "Home") next = MIN_CHAT_WIDTH;
    if (event.key === "End") next = MAX_CHAT_WIDTH;
    if (next == null) return;
    event.preventDefault();
    const clamped = clampChatWidth(next);
    setChatWidth(clamped);
    saveChatWidth(clamped);
  };

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
                headerActions={headerActions}
                dataSource={dataSource}
                locale={locale}
                direction={dir}
                theme={chartTheme}
                capture={capture}
                tradingEnabled={!guest && !capture && Boolean(capital.connected)}
                className="h-full min-h-0 w-full"
                onSymbolChange={handleSymbolChange}
                onIntervalChange={handleIntervalChange}
              />
            </ChartErrorBoundary>

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
            role="separator"
            aria-orientation="vertical"
            aria-label={t("layout.resize_chat")}
            aria-valuemin={MIN_CHAT_WIDTH}
            aria-valuemax={MAX_CHAT_WIDTH}
            aria-valuenow={chatWidth}
            tabIndex={0}
            onPointerDown={startChatResize}
            onKeyDown={resizeChatWithKeyboard}
            className={cn(
              "group hidden w-3 shrink-0 cursor-col-resize items-stretch justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
              // Only meaningful when both panes are up.
              desktopLayout === "split" && "xl:flex",
            )}
          >
            <span className="w-px bg-border/50 transition-colors group-hover:bg-primary/70 group-focus-visible:bg-primary" />
          </div>
        )}

        {chatEnabled && (
          <div className={chatPaneClass}>
            {/* Mode / account state live in the top bar (N18). Execution stage
                remains in the composer + menu — not as a row above the chat. */}
            <SmartChartAgentPanel
              key={chat.activeChatId ?? "home"}
              ref={agentRef}
              symbol={symbol}
              interval={interval}
              layoutId={layoutId}
              dataSource={dataSource}
              chatId={chat.activeChatId ?? undefined}
              initialMessages={chat.activeMessages}
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
              brokerConnected={forexOnline}
              onSymbolChange={handleSymbolChange}
              onIntervalChange={handleIntervalChange}
              onResult={handleAgentResult}
              onVoiceFinal={voice.handleAgentFinal}
              onPersistMessage={chat.persistMessage}
              ensureChatId={chat.ensureChat}
              voiceControl={<AgentVoiceButton voice={voice} disabled={false} />}
              voicePanel={<AgentVoicePanel voice={voice} />}
            />
          </div>
        )}
      </div>

      <OpenTradesDrawer open={tradesOpen} onClose={() => setTradesOpen(false)} />

    </div>
  );
}
