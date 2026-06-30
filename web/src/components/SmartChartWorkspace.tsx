"use client";



import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { createPortal } from "react-dom";

import dynamic from "next/dynamic";
import type { KLineChartHandle } from "@/components/chart/KLineChart";

const KLineChart = dynamic(() => import("@/components/chart/KLineChart"), {
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

import { SmartChartToolbar } from "@/components/chart/SmartChartToolbar";

import { useEaLivePrice } from "@/hooks/useEaLivePrice";

import { useChartAnalysis } from "@/hooks/useChartAnalysis";

import { useAccountCapital } from "@/hooks/useAccountCapital";

import { prefetchKlines } from "@/lib/ohlc/klinesClientCache";

import { normalizeInterval } from "@/lib/intervals";

import type { Recommendation } from "@/lib/types";

import { normalizeTradingStyle, type TradingStyle } from "@/lib/types";

import type { MarketType } from "@/lib/markets/types";



const LS_SYMBOL = "aichart_last_symbol";

const LS_INTERVAL = "aichart_last_interval";

const DEFAULT_SYMBOL = "EURUSD";



export function SmartChartWorkspace({

  recommendations = [],

  agentReady = true,

  onCreditsUsed,

}: {

  recommendations?: Recommendation[];

  agentReady?: boolean;

  onCreditsUsed?: () => void;

}) {

  const chartRef = useRef<KLineChartHandle>(null);

  const market: MarketType = "forex";

  const [toolbarSlot, setToolbarSlot] = useState<HTMLElement | null>(null);



  const [symbol, setSymbol] = useState(() => {

    if (typeof window === "undefined") return DEFAULT_SYMBOL;

    return localStorage.getItem(LS_SYMBOL) ?? DEFAULT_SYMBOL;

  });

  const [interval, setChartInterval] = useState(() => {

    if (typeof window === "undefined") return "15m";

    return localStorage.getItem(LS_INTERVAL) ?? "15m";

  });

  const [tradingStyle, setTradingStyle] = useState<TradingStyle>("day");

  const [tradesOpen, setTradesOpen] = useState(false);

  const [openTradesCount, setOpenTradesCount] = useState(0);

  const [hiddenLayers, setHiddenLayers] = useState<Set<number>>(new Set());

  const [executing, setExecuting] = useState(false);

  const [forexConnected, setForexConnected] = useState(false);

  const [forexOnline, setForexOnline] = useState(false);

  const [creditsRemaining, setCreditsRemaining] = useState<number | null>(null);



  const live = useEaLivePrice(symbol, true);

  const capital = useAccountCapital(market);



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

    intents,

    analyze,

    clearLayers,

    stopLiveAnalysis,

    setHighlightDrawingIndex,

  } = useChartAnalysis({

    symbol,

    interval,

    market,

    chartRef,

    source: "smart_chart",

    tradingStyle,

    onCreditsUsed: () => {

      onCreditsUsed?.();

      void refreshCredits();

    },

  });



  const visibleDrawings = useMemo(

    () => drawings.filter((_, i) => !hiddenLayers.has(i)),

    [drawings, hiddenLayers],

  );



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

    void refreshCredits();

  }, [refreshCredits]);



  useEffect(() => {

    void fetch("/api/user/trading-style", { cache: "no-store" })

      .then((r) => (r.ok ? r.json() : null))

      .then((d: { trading_style?: string } | null) => {

        if (d?.trading_style) {

          setTradingStyle(normalizeTradingStyle(d.trading_style));

        }

      })

      .catch(() => {});

  }, []);



  useEffect(() => {

    void fetch("/api/console/status", { cache: "no-store" })

      .then((r) => (r.ok ? r.json() : null))

      .then((d) => {

        if (!d) return;

        setForexConnected(Boolean(d.mt5?.connected));

        setForexOnline(Boolean(d.mt5?.online));

      })

      .catch(() => {});

  }, []);



  useEffect(() => {

    void fetch("/api/console/trades-active", { cache: "no-store" })

      .then((r) => (r.ok ? r.json() : null))

      .then((d: { rows?: unknown[] } | null) => {

        setOpenTradesCount(Array.isArray(d?.rows) ? d!.rows!.length : 0);

      })

      .catch(() => {});

    const t = setInterval(() => {

      void fetch("/api/console/trades-active", { cache: "no-store" })

        .then((r) => (r.ok ? r.json() : null))

        .then((d: { rows?: unknown[] } | null) => {

          setOpenTradesCount(Array.isArray(d?.rows) ? d!.rows!.length : 0);

        })

        .catch(() => {});

    }, 30_000);

    return () => clearInterval(t);

  }, []);



  useEffect(() => {

    localStorage.setItem(LS_SYMBOL, symbol);

  }, [symbol]);



  useEffect(() => {

    localStorage.setItem(LS_INTERVAL, interval);

  }, [interval]);



  useEffect(() => {

    prefetchKlines(symbol, interval, market);

  }, [symbol, interval, market]);



  useEffect(() => {

    setHiddenLayers(new Set());

  }, [drawings.length, symbol, interval]);



  const handleSymbolChange = useCallback((s: string) => {

    setSymbol(s.toUpperCase());

  }, []);



  const handleIntervalChange = useCallback((iv: string) => {

    setChartInterval(normalizeInterval(iv));

  }, []);



  const handleStyleChange = useCallback((style: TradingStyle) => {

    setTradingStyle(style);

  }, []);



  const handleIntervalSuggest = useCallback((iv: string) => {

    setChartInterval(normalizeInterval(iv));

  }, []);



  const handleToggleLayer = useCallback((index: number) => {

    setHiddenLayers((prev) => {

      const next = new Set(prev);

      if (next.has(index)) next.delete(index);

      else next.add(index);

      return next;

    });

  }, []);



  const handleToggleAllLayers = useCallback(

    (hide: boolean) => {

      if (!hide) {

        setHiddenLayers(new Set());

        return;

      }

      setHiddenLayers(new Set(drawings.map((_, i) => i)));

    },

    [drawings],

  );



  const handleClearLayers = useCallback(() => {

    clearLayers();

    stopLiveAnalysis();

    setHiddenLayers(new Set());

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



  const forexRefreshMs =

    interval === "1m" ? 15_000 : interval === "5m" ? 30_000 : 60_000;



  const canExecute = intents.some((i) => i.status === "pending");



  const toolbarPortal =

    toolbarSlot &&

    createPortal(

      <SmartChartToolbar

        market={market}

        tradingStyle={tradingStyle}

        onTradingStyleChange={handleStyleChange}

        onIntervalSuggest={handleIntervalSuggest}

        isAnalyzing={isAnalyzing}

        onAnalyze={() => void analyze()}

        creditsRemaining={creditsRemaining}

        capitalLoading={capital.loading}

        capitalConnected={capital.connected}

        capitalAmount={capital.amount}

        capitalCurrency={capital.currency}

        capitalLabel={capital.label}

        forexConnected={forexConnected}

        forexOnline={forexOnline}

        onOpenTrades={() => setTradesOpen(true)}

        openTradesCount={openTradesCount}

        drawings={drawings}

        hiddenLayers={hiddenLayers}

        onToggleLayer={handleToggleLayer}

        onToggleAllLayers={handleToggleAllLayers}

        onClearLayers={handleClearLayers}

      />,

      toolbarSlot,

    );



  return (

    <div className="relative flex h-full min-h-0 flex-col">

      {!agentReady && (

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

        <ChartErrorBoundary key={`${symbol}|${interval}`}>

          <KLineChart

            ref={chartRef}

            symbol={symbol}

            interval={interval}

            market={market}

            recommendations={recommendations}

            recommendation={recommendation}

            targets={targets}

            overlays={overlays}

            drawings={visibleDrawings}

            livePrice={live.price > 0 ? live.price : undefined}

            refreshMs={forexRefreshMs}

            className="h-full min-h-0 w-full"

            onToolbarSlot={setToolbarSlot}

            onSymbolChange={handleSymbolChange}

            onIntervalChange={handleIntervalChange}

          />

        </ChartErrorBoundary>



        {toolbarPortal}



        <ChartTradeOverlay

          recommendation={recommendation}

          targets={targets}

          riskReward={riskReward}

          liveReasoningLog={liveReasoningLog}

          isAnalyzing={isAnalyzing}

          liveAnalysis={liveAnalysis}

          drawings={visibleDrawings}

          onHighlightDrawing={setHighlightDrawingIndex}

          onStopLive={stopLiveAnalysis}

          onExecute={canExecute ? () => void handleExecute() : undefined}

          executing={executing}

          executeLabel={canExecute ? "موافقة وتنفيذ" : undefined}

        />

      </div>



      <OpenTradesDrawer open={tradesOpen} onClose={() => setTradesOpen(false)} />

    </div>

  );

}


