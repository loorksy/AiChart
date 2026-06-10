"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Search, Sparkles, X } from "lucide-react";
import {
  PageLayout,
  SectionTitle,
  SurfaceCard,
} from "@/components/ui/shell";
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

const INTERVALS = ["15m", "1h", "4h", "1d", "1w"];

const TOOLBAR_BTN =
  "inline-flex h-11 min-h-[44px] items-center justify-center gap-2 rounded-xl px-3 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

interface Instrument {
  symbol: string;
  base: string;
  quote: string;
}

function formatLevel(price: number | null): string {
  if (price == null) return "—";
  if (price >= 1000) return price.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (price >= 1) return price.toLocaleString(undefined, { maximumFractionDigits: 4 });
  return price.toLocaleString(undefined, { maximumFractionDigits: 6 });
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

  const toolbar = (
    <div className="flex flex-wrap items-center gap-2">
      {openAssets && (
        <div className="relative">
          <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            className="input h-11 w-40 ps-10 text-sm"
            placeholder="ابحث…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            dir="ltr"
          />
        </div>
      )}
      <select
        className="input h-11 w-auto max-w-[200px] text-sm"
        value={symbol}
        onChange={(e) => setSymbol(e.target.value)}
        dir="ltr"
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
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      )}
      <div className="flex gap-1">
        {INTERVALS.map((iv) => (
          <button
            key={iv}
            type="button"
            onClick={() => setInterval(iv)}
            className={cn(
              TOOLBAR_BTN,
              "min-w-[44px] px-3 text-xs",
              interval === iv
                ? "bg-primary text-primary-foreground"
                : "bg-secondary text-muted-foreground hover:text-foreground",
            )}
          >
            {iv}
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={() => void handleAnalyze()}
        disabled={isAnalyzing}
        className={cn(
          TOOLBAR_BTN,
          isAnalyzing
            ? "bg-secondary text-muted-foreground"
            : "bg-primary text-primary-foreground hover:opacity-90",
        )}
      >
        {isAnalyzing ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Sparkles className="h-4 w-4" />
        )}
        تحليل
      </button>
    </div>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <PageLayout
        title="الشارت الحي"
        subtitle={
          openAssets
            ? "جميع أزواج USDT من Binance — تحديث تلقائي"
            : undefined
        }
        maxWidth="full"
        actions={toolbar}
        className="shrink-0 space-y-0 !px-4 !pb-3 !pt-3"
      >
        <span className="hidden" aria-hidden="true" />
      </PageLayout>

      {analyzeError && (
        <p className="shrink-0 border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {analyzeError}
        </p>
      )}

      <div className="flex min-h-0 flex-1 flex-col px-4 pb-2">
        <SurfaceCard
          padding="none"
          className="relative min-h-0 flex-1 overflow-hidden"
        >
          <PriceChart
            symbol={symbol}
            interval={interval}
            recommendations={recommendations}
            overlays={overlays}
            fill
            className="h-full min-h-0 p-1"
          />

          {recDetailOpen && selectedRec && (
            <div className="absolute inset-x-2 top-2 z-10 overflow-hidden rounded-xl border border-border/60 bg-background/95 shadow-lg backdrop-blur-md motion-reduce:transition-none sm:inset-x-4 sm:top-4">
              <div className="flex items-center justify-between border-b border-border/40 px-3 py-2">
                <span className="text-xs font-medium text-muted-foreground">
                  تفاصيل التوصية
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setRecDetailOpen(false);
                    setSelectedRec(null);
                    setOverlays([]);
                  }}
                  className="inline-flex h-11 min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-muted-foreground transition hover:bg-secondary hover:text-foreground"
                  aria-label="إغلاق التوصية"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="space-y-3 px-3 py-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={cn(
                      "rounded-lg px-2 py-1 text-xs font-semibold",
                      selectedRec.action === "buy"
                        ? "bg-green-500/15 text-green-500"
                        : "bg-red-500/15 text-red-500",
                    )}
                  >
                    {selectedRec.action === "buy" ? "شراء" : "بيع"}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    ثقة {selectedRec.confidence}%
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-2 text-center text-xs">
                  <div className="rounded-lg bg-secondary/60 px-2 py-2">
                    <p className="text-muted-foreground">دخول</p>
                    <p className="mt-0.5 font-semibold tabular-nums" dir="ltr">
                      {formatLevel(selectedRec.entry)}
                    </p>
                  </div>
                  <div className="rounded-lg bg-secondary/60 px-2 py-2">
                    <p className="text-muted-foreground">وقف خسارة</p>
                    <p className="mt-0.5 font-semibold tabular-nums text-red-500" dir="ltr">
                      {formatLevel(selectedRec.stop_loss)}
                    </p>
                  </div>
                  <div className="rounded-lg bg-secondary/60 px-2 py-2">
                    <p className="text-muted-foreground">هدف ربح</p>
                    <p className="mt-0.5 font-semibold tabular-nums text-blue-500" dir="ltr">
                      {formatLevel(selectedRec.take_profit)}
                    </p>
                  </div>
                </div>

                {selectedRec.rationale && (
                  <p className="leading-relaxed text-foreground">
                    {selectedRec.rationale}
                  </p>
                )}
              </div>
            </div>
          )}

          {analysisOpen && (analysisText || isAnalyzing) && !recDetailOpen && (
            <div className="absolute inset-x-2 bottom-2 z-10 max-h-[40%] overflow-hidden rounded-xl border border-border/60 bg-background/95 shadow-lg backdrop-blur-md">
              <div className="flex items-center justify-between border-b border-border/40 px-3 py-2">
                <span className="text-xs font-medium text-muted-foreground">
                  {isAnalyzing ? "جارٍ التحليل…" : "تحليل الذكاء الاصطناعي"}
                </span>
                <button
                  type="button"
                  onClick={() => setAnalysisOpen(false)}
                  className="inline-flex h-11 min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-muted-foreground transition hover:bg-secondary hover:text-foreground"
                  aria-label="إغلاق التحليل"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="overflow-y-auto px-3 py-2 text-sm leading-relaxed text-foreground">
                {analysisText || (
                  <span className="text-muted-foreground">جارٍ التحليل…</span>
                )}
                {isAnalyzing && (
                  <span className="ms-1 inline-block h-3 w-1 animate-pulse bg-primary" />
                )}
              </div>
            </div>
          )}
        </SurfaceCard>
      </div>

      {symbolRecs.length > 0 && (
        <div className="shrink-0 border-t border-border/60 bg-card/80 px-4 py-3 backdrop-blur-md">
          <SectionTitle className="mb-2">
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
                    ? "border-primary bg-secondary"
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
                {(r.entry != null || r.stop_loss != null || r.take_profit != null) && (
                  <p className="mt-1 text-[10px] text-muted-foreground" dir="ltr">
                    {r.entry != null && `E ${formatLevel(r.entry)}`}
                    {r.stop_loss != null && ` · SL ${formatLevel(r.stop_loss)}`}
                    {r.take_profit != null && ` · TP ${formatLevel(r.take_profit)}`}
                  </p>
                )}
                {r.rationale && (
                  <p className="mt-1 max-w-[200px] truncate text-muted-foreground">
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
