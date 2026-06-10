"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SectionTitle, SurfaceCard } from "@/components/ui/shell";
import { ChartLivePriceBadge } from "@/components/market/ChartLivePriceBadge";
import { ChartOverlayToolbar } from "@/components/market/ChartOverlayToolbar";
import { MarketRecPanel } from "@/components/market/MarketRecPanel";
import { formatLevel } from "@/components/market/formatLevel";
import { useBinanceLivePrice } from "@/hooks/useBinanceLivePrice";
import { cn } from "@/lib/utils";
import PriceChart from "./PriceChart";
import type { ChartOverlay } from "@/lib/chartOverlays";
import {
  overlaysFromAnalysis,
  overlaysFromRecommendation,
} from "@/lib/chartOverlays";
import type { ChartDrawing } from "@/lib/chartDrawings";
import { parseChartDrawingsJson } from "@/lib/chartDrawings";
import type { MarketSnapshot } from "@/lib/market";
import { consumeSse } from "@/lib/sse";
import type { Recommendation } from "@/lib/types";

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
    trend: "sideways",
    summary: "",
  };
}

export default function MarketClient({
  openAssets,
  allowedAssets,
  recommendations,
}: {
  openAssets: boolean;
  allowedAssets: string[];
  recommendations: Recommendation[];
}) {
  const symbols = openAssets
    ? []
    : allowedAssets.length
      ? allowedAssets
      : ["BTCUSDT", "ETHUSDT"];

  const [symbol, setSymbol] = useState(
    openAssets ? "BTCUSDT" : symbols[0] ?? "BTCUSDT",
  );
  const [interval, setInterval] = useState("1h");
  const [search, setSearch] = useState("");
  const [instruments, setInstruments] = useState<Instrument[]>([]);
  const [loadingInstruments, setLoadingInstruments] = useState(false);

  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisText, setAnalysisText] = useState("");
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const [overlays, setOverlays] = useState<ChartOverlay[]>([]);
  const [drawings, setDrawings] = useState<ChartDrawing[]>([]);
  const [profileLabel, setProfileLabel] = useState<string | null>(null);
  const [contextSummary, setContextSummary] = useState<string[]>([]);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);

  const [selectedRec, setSelectedRec] = useState<Recommendation | null>(null);
  const [recDetailOpen, setRecDetailOpen] = useState(false);

  const chartFrameRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const live = useBinanceLivePrice(symbol);

  const fetchInstruments = useCallback(async (q: string) => {
    setLoadingInstruments(true);
    try {
      const params = q ? `?q=${encodeURIComponent(q)}&wrapped=1` : "?wrapped=1";
      const res = await fetch(`/api/instruments${params}`);
      const data = await res.json();
      if (res.ok) {
        setInstruments(
          Array.isArray(data) ? data : (data.instruments ?? []),
        );
      }
    } catch {
      setInstruments([]);
    } finally {
      setLoadingInstruments(false);
    }
  }, []);

  useEffect(() => {
    if (!openAssets) return;
    const t = setTimeout(() => void fetchInstruments(search), 300);
    return () => clearTimeout(t);
  }, [openAssets, search, fetchInstruments]);

  function clearChartLayers() {
    setOverlays([]);
    setDrawings([]);
    setSelectedRec(null);
    setProfileLabel(null);
    setContextSummary([]);
  }

  useEffect(() => {
    clearChartLayers();
    setAnalysisText("");
    setAnalysisOpen(false);
    setAnalyzeError(null);
    setRecDetailOpen(false);
  }, [symbol, interval]);

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
    : symbols.map((s) => ({
        symbol: s,
        base: s.replace(/USDT$/, ""),
        quote: "USDT",
      }));

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

  async function handleAnalyze() {
    if (isAnalyzing) return;
    setIsAnalyzing(true);
    setAnalyzeError(null);
    setAnalysisText("");
    clearChartLayers();
    setRecDetailOpen(false);
    setAnalysisOpen(true);

    try {
      const res = await fetch("/api/market/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol, interval, stream: true }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setAnalyzeError(
          (data as { error?: string }).error ?? "تعذّر بدء التحليل.",
        );
        return;
      }

      let streamError: string | null = null;
      let streamed = "";

      const data = await consumeSse<{
        reply: string;
        overlays?: ChartOverlay[];
        drawings?: ChartDrawing[];
        profileLabel?: string;
        contextSummary?: string[];
        telegramSent?: boolean;
      }>(res, {
        onDelta: (t) => {
          streamed += t;
          setAnalysisText(streamed);
        },
        onError: (msg) => {
          streamError = msg;
          setAnalyzeError(msg);
        },
      });

      if (!data) {
        if (!streamError) setAnalyzeError("لم يصل تحليل من الوكيل.");
        return;
      }

      setAnalysisText(data.reply || streamed);
      if (data.overlays?.length) setOverlays(data.overlays);
      if (data.drawings?.length) setDrawings(data.drawings);
      if (data.profileLabel) setProfileLabel(data.profileLabel);
      if (data.contextSummary?.length) setContextSummary(data.contextSummary);
    } catch {
      setAnalyzeError("حدث خطأ أثناء التحليل.");
    } finally {
      setIsAnalyzing(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {analyzeError && (
        <p className="shrink-0 border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {analyzeError}
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
              symbol={symbol}
              interval={interval}
              recommendations={recommendations}
              overlays={overlays}
              drawings={drawings}
              livePrice={live.price > 0 ? live.price : undefined}
              fill
              className="h-full min-h-0 p-0"
            />

            <ChartOverlayToolbar
              openAssets={openAssets}
              search={search}
              onSearchChange={setSearch}
              symbol={symbol}
              onSymbolChange={setSymbol}
              pickerOptions={pickerOptions}
              loadingInstruments={loadingInstruments}
              interval={interval}
              onIntervalChange={setInterval}
              isAnalyzing={isAnalyzing}
              onAnalyze={() => void handleAnalyze()}
              isFullscreen={isFullscreen}
              onToggleFullscreen={() => void toggleFullscreen()}
              hasChartLayers={overlays.length > 0 || drawings.length > 0}
              onClearLayers={clearChartLayers}
            />

            <ChartLivePriceBadge symbol={symbol} />
          </div>
        </SurfaceCard>

        {panelOpen && (
          <MarketRecPanel
            open={panelOpen}
            onClose={closePanel}
            kind={panelKind}
            rec={selectedRec}
            analysisText={analysisText}
            isAnalyzing={isAnalyzing}
            profileLabel={profileLabel}
            contextSummary={contextSummary}
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
