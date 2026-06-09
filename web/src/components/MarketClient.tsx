"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Search, Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";
import PriceChart from "./PriceChart";
import type { ChartOverlay } from "@/lib/chartOverlays";
import { consumeSse } from "@/lib/sse";
import type { Recommendation } from "@/lib/types";

const INTERVALS = ["15m", "1h", "4h", "1d", "1w"];

interface Instrument {
  symbol: string;
  base: string;
  quote: string;
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
  }, [symbol, interval]);

  const pickerOptions = openAssets
    ? instruments
    : symbols.map((s) => ({
        symbol: s,
        base: s.replace(/USDT$/, ""),
        quote: "USDT",
      }));

  const symbolRecs = recommendations.filter((r) => r.symbol === symbol);

  async function handleAnalyze() {
    if (isAnalyzing) return;
    setIsAnalyzing(true);
    setAnalyzeError(null);
    setAnalysisText("");
    setOverlays([]);
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
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border/60 bg-background px-4 py-3">
        <div>
          <h1 className="page-title text-base sm:text-lg">الشارت الحي</h1>
          {openAssets && (
            <p className="text-[11px] text-muted-foreground">
              جميع أزواج USDT من Binance — تحديث تلقائي
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {openAssets && (
            <div className="relative">
              <Search className="absolute start-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                className="input w-40 py-1.5 ps-9 text-sm"
                placeholder="ابحث…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                dir="ltr"
              />
            </div>
          )}
          <select
            className="input w-auto max-w-[200px] py-1.5 text-sm"
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
            <span className="text-xs text-muted-foreground">…</span>
          )}
          <div className="flex gap-1">
            {INTERVALS.map((iv) => (
              <button
                key={iv}
                type="button"
                onClick={() => setInterval(iv)}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-xs font-medium",
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
              "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition",
              isAnalyzing
                ? "bg-secondary text-muted-foreground"
                : "bg-primary text-primary-foreground hover:opacity-90",
            )}
          >
            {isAnalyzing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
            تحليل
          </button>
        </div>
      </div>

      {analyzeError && (
        <p className="shrink-0 border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {analyzeError}
        </p>
      )}

      <div className="relative flex min-h-0 flex-1 flex-col p-2 md:p-4">
        <div className="surface-card relative min-h-0 flex-1 overflow-hidden p-1">
          <PriceChart
            symbol={symbol}
            interval={interval}
            recommendations={recommendations}
            overlays={overlays}
            fill
            className="h-full min-h-0"
          />

          {analysisOpen && (analysisText || isAnalyzing) && (
            <div className="absolute inset-x-2 bottom-2 z-10 max-h-[40%] overflow-hidden rounded-xl border border-border/60 bg-background/95 shadow-lg backdrop-blur-md">
              <div className="flex items-center justify-between border-b border-border/40 px-3 py-2">
                <span className="text-xs font-medium text-muted-foreground">
                  {isAnalyzing ? "جارٍ التحليل…" : "تحليل الذكاء الاصطناعي"}
                </span>
                <button
                  type="button"
                  onClick={() => setAnalysisOpen(false)}
                  className="rounded-md p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
                  aria-label="إغلاق التحليل"
                >
                  <X className="h-3.5 w-3.5" />
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
        </div>
      </div>

      {symbolRecs.length > 0 && (
        <div className="shrink-0 border-t border-border/60 bg-card/80 px-4 py-3 backdrop-blur-md">
          <p className="mb-2 text-xs font-medium text-muted-foreground">
            آخر توصيات {symbol}
          </p>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {symbolRecs.slice(0, 5).map((r) => (
              <div
                key={r.id}
                className="shrink-0 rounded-lg border border-border bg-secondary px-3 py-2 text-xs"
              >
                <span
                  className={cn(
                    "font-semibold",
                    r.action === "buy" ? "text-green-600" : "text-red-500",
                  )}
                >
                  {r.action === "buy" ? "شراء" : "بيع"} {r.confidence}%
                </span>
                {r.rationale && (
                  <p className="mt-1 max-w-[200px] truncate text-muted-foreground">
                    {r.rationale}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
