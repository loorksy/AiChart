"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SectionTitle, SurfaceCard } from "@/components/ui/shell";
import { ChartOverlayToolbar } from "@/components/market/ChartOverlayToolbar";
import { MarketRecPanel } from "@/components/market/MarketRecPanel";
import { ChartTradeOverlay } from "@/components/chart/ChartTradeOverlay";
import { formatLevel } from "@/components/market/formatLevel";
import { useBinanceLivePrice } from "@/hooks/useBinanceLivePrice";
import { useChartAnalysis } from "@/hooks/useChartAnalysis";
import { cn } from "@/lib/utils";
import PriceChart, { type PriceChartHandle } from "./PriceChart";
import {
  overlaysFromAnalysis,
  overlaysFromRecommendation,
} from "@/lib/chartOverlays";
import { parseChartDrawingsJson } from "@/lib/chartDrawings";
import type { MarketSnapshot } from "@/lib/market";
import type { Recommendation } from "@/lib/types";
import type { MarketType } from "@/lib/markets/types";
import { useEaLivePrice } from "@/hooks/useEaLivePrice";
import { normalizeInterval } from "@/lib/intervals";
import { prefetchKlines } from "@/lib/ohlc/klinesClientCache";

const LS_SYMBOL = "aichart_last_symbol";
const LS_INTERVAL = "aichart_last_interval";
const LS_MARKET = "aichart_last_market";

interface Instrument {
  symbol: string;
  base: string;
  quote: string;
}

function emptySnap(symbol: string, interval: string, price = 0): MarketSnapshot {
  return {
    symbol,
    interval,
    price,
    change24hPct: 0,
    high24h: 0,
    low24h: 0,
    rsi14: null,
    sma20: null,
    sma50: null,
    ema20: null,
    macd: null,
    atr14: null,
    trend: "sideways",
    summary: "",
  };
}

const DEFAULT_SYMBOL: Record<MarketType, string> = {
  crypto: "BTCUSDT",
  forex: "EURUSD",
};

export default function MarketClient({
  initialMarket = "crypto",
  cryptoOpen,
  cryptoAllowed,
  forexOpen,
  forexAllowed,
  eaOnline = false,
  eaConnected = false,
  recommendations,
}: {
  initialMarket?: MarketType;
  cryptoOpen: boolean;
  cryptoAllowed: string[];
  forexOpen: boolean;
  forexAllowed: string[];
  eaOnline?: boolean;
  eaConnected?: boolean;
  recommendations: Recommendation[];
}) {
  const [market, setMarket] = useState<MarketType>(initialMarket);

  const openAssets = market === "forex" ? forexOpen : cryptoOpen;
  const allowedAssets = market === "forex" ? forexAllowed : cryptoAllowed;

  const fallbackSymbols =
    market === "forex" ? ["EURUSD", "XAUUSD", "GBPUSD"] : ["BTCUSDT", "ETHUSDT"];
  const symbols = openAssets
    ? []
    : allowedAssets.length
      ? allowedAssets
      : fallbackSymbols;

  const [symbol, setSymbol] = useState(
    openAssets ? DEFAULT_SYMBOL[initialMarket] : symbols[0] ?? DEFAULT_SYMBOL[initialMarket],
  );
  const [interval, setMarketInterval] = useState<string>(() => {
    if (typeof window === "undefined") return "1h";
    try {
      const stored = localStorage.getItem(LS_INTERVAL);
      return stored ? normalizeInterval(stored) : "1h";
    } catch {
      return "1h";
    }
  });
  const [search, setSearch] = useState("");
  const [instruments, setInstruments] = useState<Instrument[]>([]);
  const [loadingInstruments, setLoadingInstruments] = useState(false);

  const [isScanning, setIsScanning] = useState(false);
  const [scanToast, setScanToast] = useState<string | null>(null);
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const [selectedRec, setSelectedRec] = useState<Recommendation | null>(null);
  const [recDetailOpen, setRecDetailOpen] = useState(false);

  const chartFrameRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<PriceChartHandle>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const cryptoLive = useBinanceLivePrice(market === "crypto" ? symbol : "");
  const forexLive = useEaLivePrice(symbol, market === "forex");
  const live = market === "forex" ? forexLive : cryptoLive;

  const {
    isAnalyzing,
    analysisText,
    overlays,
    drawings,
    recommendation,
    profileLabel,
    contextSummary,
    analyzeError,
    toast,
    analyzeActivities,
    chartVisionLabel,
    liveAnalysis,
    riskReward,
    highlightDrawingIndex,
    setHighlightDrawingIndex,
    analyze,
    clearLayers,
    stopLiveAnalysis,
    setOverlays,
    setDrawings,
    setRecommendation,
  } = useChartAnalysis({
    symbol,
    interval,
    market,
    chartRef,
    source: "market",
  });

  const fetchInstruments = useCallback(
    async (q: string) => {
      setLoadingInstruments(true);
      try {
        const base = `?market=${market}&wrapped=1`;
        const params = q ? `${base}&q=${encodeURIComponent(q)}` : base;
        const res = await fetch(`/api/instruments${params}`);
        const data = await res.json();
        if (res.ok) {
          const list = Array.isArray(data)
            ? data
            : (data.instruments ?? []);
          setInstruments(list);
          for (const inst of list.slice(0, 12)) {
            prefetchKlines(inst.symbol, interval, market, 120);
          }
        }
      } catch {
        setInstruments([]);
      } finally {
        setLoadingInstruments(false);
      }
    },
    [market, interval],
  );

  const handlePickerOpen = useCallback(() => {
    if (instruments.length === 0) {
      void fetchInstruments("");
    }
  }, [instruments.length, fetchInstruments]);

  useEffect(() => {
    const t = window.setTimeout(() => void fetchInstruments(search), 300);
    return () => window.clearTimeout(t);
  }, [search, fetchInstruments]);

  useEffect(() => {
    try {
      const storedMarket = localStorage.getItem(LS_MARKET);
      const storedSymbol = localStorage.getItem(LS_SYMBOL);
      if (storedSymbol && storedMarket === market) {
        setSymbol(storedSymbol);
      }
    } catch {
      /* ignore */
    }
  }, [market]);

  useEffect(() => {
    try {
      localStorage.setItem(LS_SYMBOL, symbol);
      localStorage.setItem(LS_INTERVAL, interval);
      localStorage.setItem(LS_MARKET, market);
    } catch {
      /* ignore */
    }
    prefetchKlines(symbol, interval, market);
  }, [symbol, interval, market]);

  const handleMarketChange = useCallback(
    (next: MarketType) => {
      if (next === market) return;
      setMarket(next);
      setSearch("");
      setInstruments([]);
      const nextOpen = next === "forex" ? forexOpen : cryptoOpen;
      const nextAllowed = next === "forex" ? forexAllowed : cryptoAllowed;
      setSymbol(
        nextOpen ? DEFAULT_SYMBOL[next] : nextAllowed[0] ?? DEFAULT_SYMBOL[next],
      );
      void fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active_market: next }),
      }).catch(() => {});
    },
    [market, forexOpen, cryptoOpen, forexAllowed, cryptoAllowed],
  );

  useEffect(() => {
    if (!scanToast) return;
    const t = setTimeout(() => setScanToast(null), 4500);
    return () => clearTimeout(t);
  }, [scanToast]);

  useEffect(() => {
    setRecDetailOpen(false);
    if (!liveAnalysis) setAnalysisOpen(false);
  }, [symbol, interval, liveAnalysis]);

  useEffect(() => {
    const onFsChange = () => {
      setIsFullscreen(document.fullscreenElement === chartFrameRef.current);
    };
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  async function toggleFullscreen() {
    const el = chartFrameRef.current;
    if (!el) return;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await el.requestFullscreen();
    } catch {
      /* unsupported or denied */
    }
  }

  const pickerOptions = openAssets
    ? instruments
    : symbols.map((s) =>
        market === "forex"
          ? {
              symbol: s,
              base: /^[A-Z]{6}/.test(s) ? s.slice(0, 3) : s,
              quote: /^[A-Z]{6}/.test(s) ? s.slice(3, 6) : "",
            }
          : { symbol: s, base: s.replace(/USDT$/, ""), quote: "USDT" },
      );

  const symbolRecs = recommendations.filter((r) => r.symbol === symbol);

  const panelOpen = recDetailOpen || analysisOpen;
  const panelKind = recDetailOpen ? "rec" : "analysis";

  function closePanel() {
    if (recDetailOpen) setRecDetailOpen(false);
    if (analysisOpen) setAnalysisOpen(false);
  }

  function selectRecommendation(rec: Recommendation) {
    setSelectedRec(rec);
    setRecDetailOpen(true);
    setAnalysisOpen(false);
    setRecommendation(rec);
    const recOverlays = overlaysFromRecommendation(rec);
    setOverlays(
      recOverlays.length > 0
        ? recOverlays
        : overlaysFromAnalysis(
            rec,
            emptySnap(rec.symbol, interval, rec.entry ?? 0),
          ),
    );
    setDrawings(parseChartDrawingsJson(rec.chart_drawings_json));
  }

  async function handleQuickScan() {
    if (isScanning) return;
    setIsScanning(true);
    try {
      const res = await fetch("/api/opportunities/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deep: false,
          skipCooldown: true,
          symbol,
          interval,
          market,
          focusOnly: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setScanToast(
          (data as { error?: string }).error ?? "تعذّر المسح.",
        );
        return;
      }
      const count = (data as { candidates?: unknown[] }).candidates?.length ?? 0;
      setScanToast(
        count > 0
          ? `وُجدت ${count} فرصة على ${symbol} · ${interval}`
          : `لا فرص واضحة على ${symbol} · ${interval}`,
      );
    } catch {
      setScanToast("تعذّر الاتصال أثناء المسح.");
    } finally {
      setIsScanning(false);
    }
  }

  async function handleAnalyze() {
    setRecDetailOpen(false);
    setAnalysisOpen(true);
    await analyze();
  }

  function handleClearLayers() {
    clearLayers();
    setSelectedRec(null);
    stopLiveAnalysis();
  }

  const activeRec = selectedRec ?? recommendation;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {analyzeError && (
        <p className="shrink-0 border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {analyzeError}
        </p>
      )}
      {toast && (
        <p className="shrink-0 border-b border-primary/30 bg-primary/10 px-4 py-2 text-sm text-primary">
          {toast}
        </p>
      )}
      {scanToast && (
        <p className="shrink-0 border-b border-primary/30 bg-primary/10 px-4 py-2 text-sm text-primary">
          {scanToast}
        </p>
      )}

      <div className="relative flex min-h-0 flex-1 flex-col gap-2 p-2 lg:flex-row">
        <SurfaceCard
          padding="none"
          className={cn(
            "relative min-h-0 min-w-0 flex-1 overflow-hidden",
            isFullscreen && "rounded-none border-0",
          )}
        >
          <div
            ref={chartFrameRef}
            className={cn(
              "relative h-full min-h-[50dvh] w-full bg-card",
              isFullscreen && "min-h-dvh",
            )}
          >
            <PriceChart
              ref={chartRef}
              symbol={symbol}
              interval={interval}
              market={market}
              recommendations={recommendations}
              overlays={overlays}
              drawings={drawings}
              livePrice={live.price > 0 ? live.price : undefined}
              liveTick={live}
              refreshMs={market === "forex" ? 60_000 : 0}
              fill
              className="h-full min-h-0 p-0"
            />

            <ChartTradeOverlay
              recommendation={activeRec}
              riskReward={riskReward}
              isAnalyzing={isAnalyzing}
              liveAnalysis={liveAnalysis}
              drawings={drawings}
              onHighlightDrawing={setHighlightDrawingIndex}
              onStopLive={stopLiveAnalysis}
            />

            <ChartOverlayToolbar
              market={market}
              onMarketChange={handleMarketChange}
              forexConnected={eaConnected}
              forexOnline={eaOnline}
              openAssets={openAssets}
              search={search}
              onSearchChange={setSearch}
              onPickerOpen={handlePickerOpen}
              symbol={symbol}
              onSymbolChange={setSymbol}
              pickerOptions={pickerOptions}
              loadingInstruments={loadingInstruments}
              interval={interval}
              onIntervalChange={setMarketInterval}
              isAnalyzing={isAnalyzing}
              onAnalyze={() => void handleAnalyze()}
              isScanning={isScanning}
              onQuickScan={() => void handleQuickScan()}
              isFullscreen={isFullscreen}
              onToggleFullscreen={() => void toggleFullscreen()}
              hasChartLayers={overlays.length > 0 || drawings.length > 0}
              onClearLayers={handleClearLayers}
              liveAnalysis={liveAnalysis}
              onStopLiveAnalysis={stopLiveAnalysis}
              live={live}
            />
          </div>
        </SurfaceCard>

        {panelOpen && (
          <MarketRecPanel
            open={panelOpen}
            onClose={closePanel}
            kind={panelKind}
            rec={selectedRec ?? recommendation ?? undefined}
            analysisText={analysisText}
            isAnalyzing={isAnalyzing}
            profileLabel={profileLabel}
            contextSummary={contextSummary}
            symbol={symbol}
            interval={interval}
            chartVisionLabel={chartVisionLabel}
            activities={analyzeActivities}
          />
        )}
      </div>

      {symbolRecs.length > 0 && (
        <div className="shrink-0 border-t border-border/60 bg-card/80 px-4 py-3 backdrop-blur-md">
          <SectionTitle className="mb-2 text-xs">
            آخر توصيات {symbol}
          </SectionTitle>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {symbolRecs.slice(0, 5).map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => selectRecommendation(r)}
                className={cn(
                  "shrink-0 rounded-xl border px-3 py-2 text-start text-xs transition",
                  selectedRec?.id === r.id
                    ? "border-primary/50 bg-primary/10"
                    : "border-border bg-card hover:border-foreground/20 hover:bg-secondary/50",
                )}
              >
                <span
                  className={cn(
                    "font-semibold",
                    r.action === "buy" ? "text-green-500" : "text-red-500",
                  )}
                >
                  {r.action === "buy" ? "شراء" : "بيع"} {r.confidence}%
                </span>
                {(r.entry != null ||
                  r.stop_loss != null ||
                  r.take_profit != null) && (
                  <p
                    className="mt-1 text-[10px] text-muted-foreground"
                    dir="ltr"
                  >
                    {r.entry != null && `E ${formatLevel(r.entry)}`}
                    {r.stop_loss != null && ` · SL ${formatLevel(r.stop_loss)}`}
                    {r.take_profit != null &&
                      ` · TP ${formatLevel(r.take_profit)}`}
                  </p>
                )}
                {r.rationale && (
                  <p className="mt-1 max-w-[180px] truncate text-muted-foreground">
                    {r.rationale}
                  </p>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
