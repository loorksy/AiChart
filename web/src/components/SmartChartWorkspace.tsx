"use client";

import {
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
import { CandlestickChart, MessageSquare } from "lucide-react";
import type { TvChartHandle, TvHeaderAction } from "@/components/chart/TvChart";

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
import { AgentChatSidebar } from "@/components/agent/AgentChatSidebar";
import { AgentVoiceButton } from "@/components/agent/AgentVoiceButton";
import { AgentVoicePanel } from "@/components/agent/AgentVoicePanel";
import { useChatSessions } from "@/hooks/useChatSessions";
import { useAgentVoiceSession } from "@/hooks/useAgentVoiceSession";
import { useMe } from "@/hooks/useMe";
import { useLocale } from "@/hooks/useLocale";
import { useTheme } from "@/components/ThemeProvider";
import {
  DEFAULT_MOBILE_PANE,
  MAX_CHAT_WIDTH,
  MIN_CHAT_WIDTH,
  clampChatWidth,
  loadChatWidth,
  saveChatWidth,
  type MobilePane,
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
const DEFAULT_SYMBOL = "EURUSD";

/** Persisted layout state (drawings + recommendation) for refresh survival. */
export interface ChartLayoutState extends ChartHydrateSnapshot {
  targets?: number[];
  /** Candle source for the active symbol: OANDA or the user's broker (EA). */
  dataSource?: "oanda" | "ea";
}

export function SmartChartWorkspace({
  recommendations = [],
  agentReady = true,
  guest = false,
  initialSymbol,
  layoutId,
  initialInterval,
  initialState,
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
}) {
  const chartRef = useRef<TvChartHandle>(null);
  const agentRef = useRef<SmartChartAgentHandle>(null);
  // Last final agent result — surfaced read-only via the dev/test debug bridge.
  const lastFinalResultRef = useRef<AgentFinalResult | null>(null);
  const [mobilePane, setMobilePane] = useState<MobilePane>(DEFAULT_MOBILE_PANE);
  const chatEnabled = !guest;

  const { locale, t, dir } = useLocale();
  const { resolved: chartTheme } = useTheme();
  const router = useRouter();

  // Desktop chat-panel width (persisted, clamped). Not used on mobile.
  const [chatWidth, setChatWidth] = useState<number>(() => loadChatWidth());

  const market: MarketType = "forex";

  const [symbol, setSymbol] = useState(() => {
    if (initialSymbol) return initialSymbol.toUpperCase();
    if (typeof window === "undefined") return DEFAULT_SYMBOL;
    return localStorage.getItem(LS_SYMBOL) ?? DEFAULT_SYMBOL;
  });

  const [interval, setChartInterval] = useState(() => {
    if (initialInterval) return normalizeInterval(initialInterval);
    if (typeof window === "undefined") return "15m";
    return localStorage.getItem(LS_INTERVAL) ?? "15m";
  });

  const [dataSource, setDataSource] = useState<"oanda" | "ea">("oanda");
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
    if (guest || !layoutId) return;
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
    if (guest || !layoutId) return;
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
        // Remote change (MCP draw / analysis finished elsewhere) — hydrate.
        layoutCursorRef.current = d.updated_at;
        if (savePendingRef.current) return;
        if (d.state) {
          hydrateFromSnapshot(d.state);
          if (d.state.dataSource === "oanda") {
            setDataSource("oanda");
          }
        }
        if (d.symbol && d.symbol !== symbol) setSymbol(d.symbol.toUpperCase());
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
  }, [guest, layoutId, isAnalyzing, symbol, interval, hydrateFromSnapshot]);

  useEffect(() => {
    prefetchKlines(symbol, interval, market);
  }, [symbol, interval, market]);

  const handleSymbolChange = useCallback((s: string) => {
    setSymbol(s.toUpperCase());
    setDataSource("oanda");
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
    setMobilePane("chat");
    // Defer so the panel mounts before the imperative call.
    setTimeout(() => agentRef.current?.quickAnalyze(), 0);
  }, [guest, router]);

  const hasLayers =
    drawings.length > 0 || overlays.length > 0 || recommendation != null;

  // Platform buttons INSIDE the TradingView header (no separate layer).
  const headerActions = useMemo<TvHeaderAction[]>(() => {
    const mtAction: TvHeaderAction = {
      id: "mt",
      text: forexOnline ? t("layout.mt_connected") : t("layout.mt_disconnected"),
      title: forexOnline ? t("layout.mt_connected") : t("layout.mt_disconnected"),
      color: forexOnline ? "#71717a" : "#f59e0b",
      onClick: () => router.push("/console/connect"),
    };
    // Clean chart top bar in agent mode: analysis lives in chat, trades/
    // recommendations in the sidebar. Only the MT status stays (plus the
    // TV-native symbol / timeframe / screenshot controls).
    if (chatEnabled) {
      return [mtAction];
    }
    // Built as a single array literal (no render-time mutation of an array that
    // holds ref-capturing click handlers).
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
    const capitalAction: TvHeaderAction[] =
      !guest && capital.connected && capital.amount != null
        ? [
            {
              id: "capital",
              text: `$ ${Math.round(capital.amount).toLocaleString()} ${capital.currency ?? ""}`,
              title: capital.label ?? t("layout.account_balance"),
            },
          ]
        : [];
    const mtStatusAction: TvHeaderAction[] = !guest
      ? [
          {
            id: "mt",
            text: forexOnline ? t("layout.mt_connected") : t("layout.mt_disconnected"),
            title: forexOnline
              ? t("layout.mt_connected")
              : t("layout.mt_setup"),
            color: forexOnline ? "#71717a" : "#f59e0b",
            onClick: () => router.push("/console/connect"),
          },
        ]
      : [];
    return [
      analyzeAction,
      ...clearAction,
      ...tradesAction,
      ...capitalAction,
      ...mtStatusAction,
    ];
  }, [
    chatEnabled,
    t,
    guest,
    isAnalyzing,
    creditsRemaining,
    hasLayers,
    openTradesCount,
    capital.connected,
    capital.amount,
    capital.currency,
    capital.label,
    forexOnline,
    router,
    handleAnalyzeClick,
    handleClearLayers,
  ]);

  const chat = useChatSessions({
    enabled: chatEnabled,
    symbol,
    interval,
    locale,
  });

  useEffect(() => {
    const select = (event: Event) => {
      const id = (event as CustomEvent<{ id?: string }>).detail?.id;
      if (!id) return;
      chat.selectChat(id);
      setMobilePane("chat");
    };
    const create = () => {
      void chat.newChat();
      setMobilePane("chat");
    };
    window.addEventListener("aichart:select-chat", select);
    window.addEventListener("aichart:new-chat", create);
    return () => {
      window.removeEventListener("aichart:select-chat", select);
      window.removeEventListener("aichart:new-chat", create);
    };
  }, [chat.newChat, chat.selectChat]);

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
    enabled: chatEnabled && Boolean(chat.activeChatId),
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
        mobilePane,
        voiceStatus: voice.status,
        lastFinalResult: publicFinalResult(lastFinalResultRef.current),
      };
    });
    return () => removeAgentDebugBridge();
  });

  // Phones and tablets show exactly one pane; wide desktop shows both.
  const showMobileChat = chatEnabled && mobilePane === "chat";
  const chartPaneClass = `relative min-h-0 flex-1 overflow-hidden ${
    showMobileChat ? "hidden xl:block" : "block"
  }`;
  // Chat: full width through tablet (when active), persisted width on desktop.
  // It sits on the right (last column, dir="ltr" row) in both locales.
  const chatPaneClass = `flex min-h-0 w-full flex-col border-border/60 xl:w-[var(--chat-w)] xl:shrink-0 ${
    mobilePane === "chart" ? "hidden xl:flex" : "flex"
  }`;

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
        <p className="pointer-events-none absolute inset-x-0 top-12 z-40 mx-auto w-fit max-w-[90%] rounded-md border border-amber-500/30 bg-amber-500/90 px-3 py-1 text-xs text-amber-950 shadow">
          {t("layout.agent_unavailable")}
        </p>
      )}

      {analyzeError && (
        <p className="pointer-events-none absolute inset-x-0 top-12 z-40 mx-auto w-fit max-w-[90%] rounded-md border border-destructive/30 bg-destructive/90 px-3 py-1 text-xs text-destructive-foreground shadow">
          {analyzeError}
        </p>
      )}

      {chatEnabled && (
        <div
          dir={dir}
          className="grid shrink-0 grid-cols-2 gap-1 border-b border-border/60 bg-card/95 p-1.5 ps-14 backdrop-blur xl:hidden"
        >
          <button
            type="button"
            aria-pressed={mobilePane === "chart"}
            onClick={() => setMobilePane("chart")}
            className={`flex min-h-11 items-center justify-center gap-2 rounded-lg px-3 text-sm font-semibold ${
              mobilePane === "chart"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted"
            }`}
          >
            <CandlestickChart className="h-4 w-4" />
            {t("layout.chart")}
          </button>
          <button
            type="button"
            aria-pressed={mobilePane === "chat"}
            onClick={() => setMobilePane("chat")}
            className={`flex min-h-11 items-center justify-center gap-2 rounded-lg px-3 text-sm font-semibold ${
              mobilePane === "chat"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted"
            }`}
          >
            <MessageSquare className="h-4 w-4" />
            {t("layout.chat")}
          </button>
        </div>
      )}

      <div
        className="flex min-h-0 flex-1 overflow-hidden"
        dir="ltr"
        style={{ "--chat-w": `${chatWidth}px` } as CSSProperties}
      >
        {chatEnabled && (
          <div className="hidden w-[240px] shrink-0 xl:block">
            <AgentChatSidebar
              sessions={chat.sessions}
              activeChatId={chat.activeChatId}
              onSelectChat={chat.selectChat}
              onNewChat={() => void chat.newChat()}
              busy={!chat.ready}
            />
          </div>
        )}

        <div className={chartPaneClass}>
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
              eaEnabled={false}
              dataSource={dataSource}
              locale={locale}
              direction={dir}
              theme={chartTheme}
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
            className="group hidden w-3 shrink-0 cursor-col-resize items-stretch justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring xl:flex"
          >
            <span className="w-px bg-border/50 transition-colors group-hover:bg-primary/70 group-focus-visible:bg-primary" />
          </div>
        )}

        {chatEnabled && (
          <div className={chatPaneClass}>
            <SmartChartAgentPanel
              key={chat.activeChatId ?? "new"}
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
              onResult={handleAgentResult}
              onVoiceFinal={voice.handleAgentFinal}
              onPersistMessage={chat.persistMessage}
              voiceControl={<AgentVoiceButton voice={voice} disabled={!chat.activeChatId} />}
              voicePanel={<AgentVoicePanel voice={voice} />}
            />
          </div>
        )}
      </div>

      <OpenTradesDrawer open={tradesOpen} onClose={() => setTradesOpen(false)} />

    </div>
  );
}
