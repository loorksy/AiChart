"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SectionTitle, SurfaceCard } from "@/components/ui/shell";
import { ChartOverlayToolbar } from "@/components/market/ChartOverlayToolbar";
import { MarketRecPanel } from "@/components/market/MarketRecPanel";
import { formatLevel } from "@/components/market/formatLevel";
import { useBinanceLivePrice } from "@/hooks/useBinanceLivePrice";
import { cn } from "@/lib/utils";
import PriceChart, { type PriceChartHandle } from "./PriceChart";
import type { ChartOverlay } from "@/lib/chartOverlays";
import {
  overlaysFromAnalysis,
  overlaysFromRecommendation,
} from "@/lib/chartOverlays";
import type { ChartDrawing } from "@/lib/chartDrawings";
import { parseChartDrawingsJson } from "@/lib/chartDrawings";
import type { MarketSnapshot } from "@/lib/market";
import { consumeSse } from "@/lib/sse";
import type { AgentActivity } from "@/lib/agentActivity";
import {
  chartVisionLabelAr,
  type ChartVisionSource,
} from "@/lib/marketAnalyzeLabels";
import type { Recommendation } from "@/lib/types";
import type { MarketType } from "@/lib/markets/types";
import { useEaLivePrice } from "@/hooks/useEaLivePrice";
import { normalizeInterval } from "@/lib/intervals";

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

  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [analysisText, setAnalysisText] = useState("");
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const [overlays, setOverlays] = useState<ChartOverlay[]>([]);
  const [drawings, setDrawings] = useState<ChartDrawing[]>([]);
  const [profileLabel, setProfileLabel] = useState<string | null>(null);
  const [contextSummary, setContextSummary] = useState<string[]>([]);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [analyzeActivities, setAnalyzeActivities] = useState<AgentActivity[]>([]);
  const [chartVisionLabel, setChartVisionLabel] = useState<string | null>(null);

  const [selectedRec, setSelectedRec] = useState<Recommendation | null>(null);
  const [recDetailOpen, setRecDetailOpen] = useState(false);

  const chartFrameRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<PriceChartHandle>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const cryptoLive = useBinanceLivePrice(market === "crypto" ? symbol : "");
  const forexLive = useEaLivePrice(symbol, market === "forex");
  const live = market === "forex" ? forexLive : cryptoLive;

  const fetchInstruments = useCallback(
    async (q: string) => {
      setLoadingInstruments(true);
      try {
        const base = `?market=${market}&wrapped=1`;
        const params = q ? `${base}&q=${encodeURIComponent(q)}` : base;
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
    },
    [market],
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
  }, [symbol, interval, market]);

  // When the market switches, reset to that market's default symbol + state.
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
      // Persist the active market preference (best-effort).
      void fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active_market: next }),
      }).catch(() => {});
    },
    [market, forexOpen, cryptoOpen, forexAllowed, cryptoAllowed],
  );

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
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(t);
  }, [toast]);

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
    setAnalyzeError(null);
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
        setAnalyzeError(
          (data as { error?: string }).error ?? "تعذّر المسح.",
        );
        return;
      }
      const count = (data as { candidates?: unknown[] }).candidates?.length ?? 0;
      setToast(
        count > 0
          ? `وُجدت ${count} فرصة على ${symbol} · ${interval}`
          : `لا فرص واضحة على ${symbol} · ${interval}`,
      );
    } catch {
      setAnalyzeError("تعذّر الاتصال أثناء المسح.");
    } finally {
      setIsScanning(false);
    }
  }

  async function handleAnalyze() {
    if (isAnalyzing) return;
    setIsAnalyzing(true);
    setAnalyzeError(null);
    setAnalysisText("");
    setAnalyzeActivities([]);
    setChartVisionLabel(null);
    setRecDetailOpen(false);
    setAnalysisOpen(true);

    try {
      const chartImage = await chartRef.current?.capturePng().catch(() => null);

      const res = await fetch("/api/market/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol,
          interval,
          market,
          stream: true,
          ...(chartImage ? { image: chartImage } : {}),
        }),
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
        telegramReasonAr?: string;
        chartVisionSource?: ChartVisionSource;
        activities?: AgentActivity[];
      }>(res, {
        onActivity: (a) => {
          setAnalyzeActivities((prev) => {
            const idx = prev.findIndex((x) => x.id === a.id);
            if (idx >= 0) {
              const next = [...prev];
              next[idx] = a;
              return next;
            }
            return [...prev, a];
          });
        },
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
      else setOverlays([]);
      if (data.drawings?.length) setDrawings(data.drawings);
      else setDrawings([]);
      if (data.profileLabel) setProfileLabel(data.profileLabel);
      if (data.contextSummary?.length) setContextSummary(data.contextSummary);
      if (data.activities?.length) setAnalyzeActivities(data.activities);
      if (data.chartVisionSource) {
        setChartVisionLabel(chartVisionLabelAr(data.chartVisionSource));
      }
      if (data.telegramSent) {
        setToast("أُرسلت التوصية إلى تليجرام — اختر المبلغ بعد الموافقة");
      } else if (
        data.telegramReasonAr &&
        data.telegramReasonAr !== "لا إشارة تنفيذية"
      ) {
        setToast(`لم يُرسل إلى تليجرام — ${data.telegramReasonAr}`);
      } else if (data.chartVisionSource === "text") {
        setToast("تعذّر التقاط الشارت — تم التحليل النصي");
      } else if (
        data.chartVisionSource === "client" ||
        data.chartVisionSource === "server"
      ) {
        setToast("تم التحليل من الشارت");
      }
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
      {toast && (
        <p className="shrink-0 border-b border-primary/30 bg-primary/10 px-4 py-2 text-sm text-primary">
          {toast}
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
              fill
              className="h-full min-h-0 p-0"
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
              onClearLayers={clearChartLayers}
              live={live}
            />
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
