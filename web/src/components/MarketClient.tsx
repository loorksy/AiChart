"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Search } from "lucide-react";
import { SectionTitle, SurfaceCard } from "@/components/ui/shell";
import { MarketIntervalTabs } from "@/components/market/MarketIntervalTabs";
import { MarketRecPanel } from "@/components/market/MarketRecPanel";
import { MarketTickerBar } from "@/components/market/MarketTickerBar";
import { formatLevel } from "@/components/market/formatLevel";
import { cn } from "@/lib/utils";
import PriceChart from "./PriceChart";
import type { ChartOverlay } from "@/lib/chartOverlays";
import {
  overlaysFromAnalysis,
  overlaysFromRecommendation,
} from "@/lib/chartOverlays";
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
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);

  const [selectedRec, setSelectedRec] = useState<Recommendation | null>(null);
  const [recDetailOpen, setRecDetailOpen] = useState(false);

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

  useEffect(() => {
    setOverlays([]);
    setAnalysisText("");
    setAnalysisOpen(false);
    setAnalyzeError(null);
    setSelectedRec(null);
    setRecDetailOpen(false);
  }, [symbol, interval]);

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
    if (recDetailOpen) {
      setRecDetailOpen(false);
      setSelectedRec(null);
      setOverlays([]);
    }
    if (analysisOpen) {
      setAnalysisOpen(false);
    }
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
  }

  async function handleAnalyze() {
    if (isAnalyzing) return;
    setIsAnalyzing(true);
    setAnalyzeError(null);
    setAnalysisText("");
    setOverlays([]);
    setSelectedRec(null);
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
    } catch {
      setAnalyzeError("حدث خطأ أثناء التحليل.");
    } finally {
      setIsAnalyzing(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* Header */}
      <header className="shrink-0 space-y-3 border-b border-border/60 px-4 py-3">
        <div>
          <h1 className="page-title text-base sm:text-lg">الشارت الحي</h1>
          {openAssets && (
            <p className="page-subtitle text-[11px] sm:text-xs">
              جميع أزواج USDT من Binance — تحديث تلقائي
            </p>
          )}
        </div>

        <MarketTickerBar
          symbol={symbol}
          onAnalyze={() => void handleAnalyze()}
          isAnalyzing={isAnalyzing}
        />

        <div className="flex flex-wrap items-center gap-2">
          {openAssets && (
            <div className="relative min-w-0 flex-1 sm:flex-none">
              <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                className="input h-11 w-full min-w-[8rem] ps-10 text-sm sm:w-44"
                placeholder="ابحث…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                dir="ltr"
              />
            </div>
          )}
          <select
            className="input h-11 w-auto max-w-[200px] shrink-0 text-sm"
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            dir="ltr"
            aria-label="اختيار الزوج"
          >
            {pickerOptions.length === 0 && (
              <option value={symbol}>{symbol}</option>
            )}
            {pickerOptions.map((inst) => (
              <option key={inst.symbol} value={inst.symbol}>
                {inst.symbol}
              </option>
            ))}
          </select>
          {openAssets && loadingInstruments && (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
          )}
          <MarketIntervalTabs value={interval} onChange={setInterval} />
        </div>
      </header>

      {analyzeError && (
        <p className="shrink-0 border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {analyzeError}
        </p>
      )}

      {/* Chart + side/bottom panel */}
      <div className="relative flex min-h-0 flex-1 flex-col gap-2 px-4 py-2 lg:flex-row">
        <SurfaceCard
          padding="none"
          className="relative min-h-[40dvh] min-w-0 flex-1 overflow-hidden lg:min-h-0"
        >
          <PriceChart
            symbol={symbol}
            interval={interval}
            recommendations={recommendations}
            overlays={overlays}
            fill
            className="h-full min-h-0 p-1"
          />
        </SurfaceCard>

        {panelOpen && (
          <MarketRecPanel
            open={panelOpen}
            onClose={closePanel}
            kind={panelKind}
            rec={selectedRec}
            analysisText={analysisText}
            isAnalyzing={isAnalyzing}
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
                    ? "border-foreground/30 bg-secondary"
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
