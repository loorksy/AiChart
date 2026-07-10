"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { CandlestickChart, MessageSquare } from "lucide-react";
import type { TvChartHandle, TvHeaderAction } from "@/components/chart/TvChart";

const TvChart = dynamic(() => import("@/components/chart/TvChart"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full min-h-[200px] items-center justify-center text-sm text-muted-foreground">
      جاري تحميل الشارت…
    </div>
  ),
});

import { ChartErrorBoundary } from "@/components/chart/ChartErrorBoundary";
import { ChartTradeOverlay } from "@/components/chart/ChartTradeOverlay";
import { OpenTradesDrawer } from "@/components/chart/OpenTradesDrawer";
import { AnalysisResultModal } from "@/components/chart/AnalysisResultModal";
import {
  SmartChartAgentPanel,
  type SmartChartAgentHandle,
} from "@/components/agent/SmartChartAgentPanel";
import { AgentChatSidebar } from "@/components/agent/AgentChatSidebar";
import { useChatSessions } from "@/hooks/useChatSessions";
import { useChartAnalysis, type ChartHydrateSnapshot } from "@/hooks/useChartAnalysis";
import { useAccountCapital } from "@/hooks/useAccountCapital";
import { prefetchKlines } from "@/lib/ohlc/klinesClientCache";
import { normalizeInterval } from "@/lib/intervals";
import { clearAgentDrawings } from "@/lib/agent/drawings/drawingOwnership";
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
  smartAgentEnabled = false,
  onCreditsUsed,
  guest = false,
  initialSymbol,
  layoutId,
  initialInterval,
  initialState,
}: {
  recommendations?: Recommendation[];
  agentReady?: boolean;
  /** When true, the docked Smart Chart Agent replaces the legacy analyze path. */
  smartAgentEnabled?: boolean;
  onCreditsUsed?: () => void;
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
  const [agentPanelOpen, setAgentPanelOpen] = useState(false);
  const [mobilePane, setMobilePane] = useState<"chart" | "chat">("chart");
  const chatEnabled = smartAgentEnabled && !guest;

  const router = useRouter();

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
  const [resultOpen, setResultOpen] = useState(false);
  const [openTradesCount, setOpenTradesCount] = useState(0);
  const [executing, setExecuting] = useState(false);
  const [forexOnline, setForexOnline] = useState(false);
  const [creditsRemaining, setCreditsRemaining] = useState<number | null>(null);

  const capital = useAccountCapital(market);

  const hydrateSnapshot = useMemo<ChartHydrateSnapshot | null>(
    () => (initialState ? initialState : null),
    [initialState],
  );

  const {
    isAnalyzing,
    analysisText,
    overlays,
    drawings,
    recommendation,
    targets,
    riskReward,
    liveAnalysis,
    analyzeError,
    liveReasoningLog,
    intents,
    analyze,
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
    chartRef,
    source: "smart_chart",
    hydrateSnapshot,
    layoutId,
    onAnalyzeDone: () => setResultOpen(true),
    onCreditsUsed: () => {
      onCreditsUsed?.();
      void refreshCredits();
    },
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

  // Analyze button: with the Smart Chart Agent, open the docked chat and fire
  // the quick prompt into the unified engine (no separate analysis path).
  const handleAnalyzeClick = useCallback(() => {
    if (guest) {
      router.push("/login?next=/chart");
      return;
    }
    if (smartAgentEnabled) {
      setAgentPanelOpen(true);
      setMobilePane("chat");
      // Defer so the panel mounts before the imperative call.
      setTimeout(() => agentRef.current?.quickAnalyze(), 0);
      return;
    }
    if (!isAnalyzing) void analyze();
  }, [guest, smartAgentEnabled, isAnalyzing, analyze, router]);

  const handleExecute = useCallback(async () => {
    const pending = intents.find((i) => i.status === "pending");
    if (!pending) return;
    setExecuting(true);
    try {
      const res = await fetch(`/api/trades/intents/${pending.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve" }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(err?.error ?? "تعذّر التنفيذ");
      }
    } catch (e) {
      console.error(e);
    } finally {
      setExecuting(false);
    }
  }, [intents]);

  const canExecute = intents.some((i) => i.status === "pending");

  const hasLayers =
    drawings.length > 0 || overlays.length > 0 || recommendation != null;

  // Platform buttons INSIDE the TradingView header (item: no separate layer).
  const headerActions = useMemo<TvHeaderAction[]>(() => {
    const actions: TvHeaderAction[] = [
      {
        id: "analyze",
        text: guest
          ? "🔒 دخول للتحليل"
          : isAnalyzing
            ? "… يُحلِّل"
            : creditsRemaining != null
              ? `✨ تحليل (${creditsRemaining})`
              : "✨ تحليل",
        title: guest
          ? "سجّل الدخول لاستخدام التحليل بالذكاء الاصطناعي"
          : "تحليل بالذكاء الاصطناعي",
        color: "#71717a",
        onClick: handleAnalyzeClick,
      },
    ];
    if (!guest && smartAgentEnabled) {
      actions.push({
        id: "agent",
        text: "💬 الوكيل",
        title: "فتح محادثة الوكيل الذكي للشارت",
        onClick: () => {
          setAgentPanelOpen((v) => !v);
          setMobilePane("chat");
        },
      });
    }
    if (!guest) {
      if (hasLayers) {
        actions.push({
          id: "clear",
          text: "🧹 مسح الرسومات",
          title: "إزالة رسومات التحليل من الشارت",
          onClick: handleClearLayers,
        });
      }
      actions.push({
        id: "trades",
        text:
          openTradesCount > 0 ? `💼 صفقات (${openTradesCount})` : "💼 صفقات",
        title: "الصفقات المفتوحة",
        onClick: () => setTradesOpen(true),
      });
      if (capital.connected && capital.amount != null) {
        actions.push({
          id: "capital",
          text: `$ ${Math.round(capital.amount).toLocaleString()} ${capital.currency ?? ""}`,
          title: capital.label ?? "رصيد الحساب",
        });
      }
      actions.push({
        id: "mt",
        text: forexOnline ? "MT ✅" : "MT ⚠️",
        title: forexOnline ? "MetaTrader متصل" : "MetaTrader غير متصل — اضغط للإعداد",
        color: forexOnline ? "#71717a" : "#f59e0b",
        onClick: () => router.push("/console/connect"),
      });
    }
    return actions;
  }, [
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
    smartAgentEnabled,
    handleAnalyzeClick,
    handleClearLayers,
  ]);

  const chat = useChatSessions({
    enabled: chatEnabled,
    symbol,
    interval,
  });

  const showMobileChat =
    smartAgentEnabled && agentPanelOpen && !guest && mobilePane === "chat";
  const chartPaneClass = showMobileChat
    ? "relative hidden min-h-0 flex-1 overflow-hidden md:block"
    : "relative min-h-0 flex-1 overflow-hidden";
  const agentPaneClass = showMobileChat
    ? "flex min-h-0 flex-1 border-r border-border/60 md:block md:w-[360px] md:shrink-0"
    : "hidden w-[360px] shrink-0 border-r border-border/60 md:block";

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      {!guest && !agentReady && (
        <p className="pointer-events-none absolute inset-x-0 top-12 z-40 mx-auto w-fit max-w-[90%] rounded-md border border-amber-500/30 bg-amber-500/90 px-3 py-1 text-xs text-amber-950 shadow">
          الذكاء الاصطناعي غير مُفعّل على الخادم — التحليل غير متاح.
        </p>
      )}

      {analyzeError && (
        <p className="pointer-events-none absolute inset-x-0 top-12 z-40 mx-auto w-fit max-w-[90%] rounded-md border border-destructive/30 bg-destructive/90 px-3 py-1 text-xs text-destructive-foreground shadow">
          {analyzeError}
        </p>
      )}

      <div className="flex min-h-0 flex-1 overflow-hidden">
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
            onExecute={canExecute ? () => void handleExecute() : undefined}
            executing={executing}
            executeLabel={canExecute ? "موافقة وتنفيذ" : undefined}
          />
        </div>

        {smartAgentEnabled && agentPanelOpen && !guest && (
          <div className={agentPaneClass}>
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
              onPersistMessage={chat.persistMessage}
              onClose={() => setAgentPanelOpen(false)}
            />
          </div>
        )}

        {smartAgentEnabled && agentPanelOpen && !guest && (
          <div className="hidden w-[240px] shrink-0 md:block">
            <AgentChatSidebar
              sessions={chat.sessions}
              activeChatId={chat.activeChatId}
              onSelectChat={chat.selectChat}
              onNewChat={() => void chat.newChat()}
              busy={!chat.ready}
            />
          </div>
        )}
      </div>

      {smartAgentEnabled && agentPanelOpen && !guest && (
        <div className="grid shrink-0 grid-cols-2 border-t border-border/60 bg-card p-1 md:hidden">
          <button
            type="button"
            onClick={() => setMobilePane("chart")}
            className={`flex items-center justify-center gap-2 rounded-md px-3 py-2 text-xs font-semibold ${
              mobilePane === "chart"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted"
            }`}
          >
            <CandlestickChart className="h-4 w-4" />
            الشارت
          </button>
          <button
            type="button"
            onClick={() => setMobilePane("chat")}
            className={`flex items-center justify-center gap-2 rounded-md px-3 py-2 text-xs font-semibold ${
              mobilePane === "chat"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted"
            }`}
          >
            <MessageSquare className="h-4 w-4" />
            الشات
          </button>
        </div>
      )}

      <OpenTradesDrawer open={tradesOpen} onClose={() => setTradesOpen(false)} />

      <AnalysisResultModal
        open={resultOpen}
        onClose={() => setResultOpen(false)}
        symbol={symbol}
        interval={interval}
        recommendation={recommendation}
        targets={targets}
        riskReward={riskReward}
        narrative={analysisText}
        reasoningLog={liveReasoningLog}
        onExecute={
          canExecute
            ? () => {
                setResultOpen(false);
                void handleExecute();
              }
            : undefined
        }
        executing={executing}
      />
    </div>
  );
}
