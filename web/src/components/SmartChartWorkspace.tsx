"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
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
import { useChartAnalysis, type ChartHydrateSnapshot } from "@/hooks/useChartAnalysis";
import { useAccountCapital } from "@/hooks/useAccountCapital";
import { prefetchKlines } from "@/lib/ohlc/klinesClientCache";
import { normalizeInterval } from "@/lib/intervals";
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
  onCreditsUsed,
  guest = false,
  initialSymbol,
  layoutId,
  initialInterval,
  initialState,
}: {
  recommendations?: Recommendation[];
  agentReady?: boolean;
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

  const [dataSource, setDataSource] = useState<"oanda" | "ea">(
    initialState?.dataSource === "ea" && !guest ? "ea" : "oanda",
  );
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
    const src = dataSource === "ea" ? "&src=ea" : "";
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
          if (d.state.dataSource === "ea" || d.state.dataSource === "oanda") {
            setDataSource(d.state.dataSource === "ea" && !guest ? "ea" : "oanda");
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
    // Prefetch only for the OANDA path — broker (EA) candles are per-user
    // on-demand via the bridge and must not be warmed anonymously.
    if (dataSource === "ea") return;
    prefetchKlines(symbol, interval, market);
  }, [symbol, interval, market, dataSource]);

  const handleSymbolChange = useCallback(
    (s: string, source: "oanda" | "ea" = "oanda") => {
      setSymbol(s.toUpperCase());
      setDataSource(source);
    },
    [],
  );

  const handleIntervalChange = useCallback((iv: string) => {
    setChartInterval(normalizeInterval(iv));
  }, []);

  const handleClearLayers = useCallback(() => {
    clearLayers();
    stopLiveAnalysis();
  }, [clearLayers, stopLiveAnalysis]);

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
        color: "#22c55e",
        onClick: () => {
          if (guest) router.push("/login?next=/chart");
          else if (!isAnalyzing) void analyze();
        },
      },
    ];
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
        color: forexOnline ? "#22c55e" : "#f59e0b",
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
    analyze,
    handleClearLayers,
  ]);

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
            eaEnabled={!guest}
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
