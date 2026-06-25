"use client";

import { useEffect, useRef } from "react";
import { EyeOff, Loader2, Maximize2, Minimize2, Radio, Sparkles, X } from "lucide-react";
import PriceChart, { type PriceChartHandle } from "@/components/PriceChart";
import { ChartTradeOverlay } from "@/components/chart/ChartTradeOverlay";
import { IntervalPicker } from "@/components/market/IntervalPicker";
import { PairPicker } from "@/components/market/PairPicker";
import { useBinanceLivePrice } from "@/hooks/useBinanceLivePrice";
import { useEaLivePrice } from "@/hooks/useEaLivePrice";
import { useChartAnalysis } from "@/hooks/useChartAnalysis";
import { prefetchKlines } from "@/lib/ohlc/klinesClientCache";
import type { Recommendation } from "@/lib/types";
import type { ProcessedIntent } from "@/lib/tradeFlow";
import { cn } from "@/lib/utils";

const CTRL =
  "inline-flex h-7 items-center justify-center gap-1 rounded-md border border-border/50 bg-background/90 text-[11px] font-medium text-foreground backdrop-blur-md transition hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function ChartPreviewPanel({
  symbol,
  interval,
  onIntervalChange,
  onSymbolChange,
  market = "crypto",
  recommendations,
  onClose,
  expanded,
  onToggleExpand,
  className,
  conversationId,
  onCreditsUsed,
  onAnalyzeStart,
  onStreamDelta,
  onAnalyzeDone,
  onRequestChatMessage,
}: {
  symbol: string;
  interval: string;
  onIntervalChange: (iv: string) => void;
  onSymbolChange?: (symbol: string) => void;
  market?: "crypto" | "forex";
  recommendations: Recommendation[];
  onClose?: () => void;
  expanded?: boolean;
  onToggleExpand?: () => void;
  className?: string;
  conversationId?: number | null;
  onCreditsUsed?: () => void;
  onAnalyzeStart?: () => void;
  onStreamDelta?: (text: string) => void;
  onAnalyzeDone?: (payload: {
    reply: string;
    recommendation?: Recommendation | null;
    intents?: ProcessedIntent[];
  }) => void;
  onRequestChatMessage?: (text: string) => void;
}) {
  const chartRef = useRef<PriceChartHandle>(null);
  const cryptoLive = useBinanceLivePrice(market === "crypto" ? symbol : "");
  const forexLive = useEaLivePrice(symbol, market === "forex");
  const live = market === "forex" ? forexLive : cryptoLive;

  const {
    isAnalyzing,
    overlays,
    drawings,
    recommendation,
    riskReward,
    liveAnalysis,
    analyzeError,
    analyze,
    clearLayers,
    stopLiveAnalysis,
    setHighlightDrawingIndex,
  } = useChartAnalysis({
    symbol,
    interval,
    market,
    chartRef,
    conversationId,
    source: "chat_chart",
    onCreditsUsed,
    onAnalyzeStart,
    onStreamDelta,
    onAnalyzeDone: (payload) => {
      onAnalyzeDone?.({
        reply: payload.reply,
        recommendation: payload.recommendation,
        intents: payload.intents,
      });
    },
  });

  useEffect(() => {
    prefetchKlines(symbol, interval, market);
  }, [symbol, interval, market]);

  async function handleAnalyze() {
    await analyze();
  }

  function handleClear() {
    clearLayers();
    stopLiveAnalysis();
  }

  return (
    <div
      className={cn(
        "flex h-full flex-col border-r border-border bg-card/95 backdrop-blur-sm",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          {onSymbolChange ? (
            <div className="w-40">
              <PairPicker
                market={market}
                value={symbol}
                onChange={onSymbolChange}
                interval={interval}
              />
            </div>
          ) : (
            <span
              className="rounded-md bg-secondary px-2 py-0.5 font-mono text-sm font-semibold text-foreground"
              dir="ltr"
            >
              {symbol}
            </span>
          )}
          {live.price > 0 && (
            <span
              className={cn(
                "hidden font-mono text-xs tabular-nums sm:inline",
                live.direction === "up" && "text-emerald-500",
                live.direction === "down" && "text-rose-500",
                !live.direction && "text-muted-foreground",
              )}
              dir="ltr"
            >
              {live.price.toLocaleString(undefined, {
                maximumFractionDigits: market === "forex" ? 5 : 2,
              })}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => void handleAnalyze()}
            disabled={isAnalyzing}
            className={cn(
              CTRL,
              "px-2 text-primary",
              isAnalyzing && "opacity-60",
              liveAnalysis && "ring-1 ring-primary/50",
            )}
            aria-label="تحليل"
            title={liveAnalysis ? "تحليل حي" : "تحليل الشارت"}
          >
            {isAnalyzing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
            <span className="hidden sm:inline">تحليل</span>
          </button>

          {liveAnalysis && (
            <button
              type="button"
              onClick={stopLiveAnalysis}
              className={cn(CTRL, "px-1.5 text-primary")}
              title="إيقاف التحليل الحي"
              aria-label="إيقاف التحليل الحي"
            >
              <Radio className="h-3.5 w-3.5" />
            </button>
          )}

          {(overlays.length > 0 || drawings.length > 0) && (
            <button
              type="button"
              onClick={handleClear}
              className={cn(CTRL, "h-7 w-7 px-0")}
              aria-label="مسح الرسومات"
            >
              <EyeOff className="h-3.5 w-3.5" />
            </button>
          )}

          <IntervalPicker value={interval} onChange={onIntervalChange} />

          {onToggleExpand && (
            <button
              type="button"
              onClick={onToggleExpand}
              className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary"
              aria-label={expanded ? "تصغير" : "توسيع"}
            >
              {expanded ? (
                <Minimize2 className="h-4 w-4" />
              ) : (
                <Maximize2 className="h-4 w-4" />
              )}
            </button>
          )}
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary"
              aria-label="إغلاق المعاينة"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {analyzeError && (
        <p className="shrink-0 border-b border-destructive/30 bg-destructive/10 px-3 py-1.5 text-xs text-destructive">
          {analyzeError}
        </p>
      )}

      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden p-2">
        <PriceChart
          ref={chartRef}
          symbol={symbol}
          interval={interval}
          recommendations={recommendations}
          market={market}
          overlays={overlays}
          drawings={drawings}
          livePrice={live.price > 0 ? live.price : undefined}
          liveTick={live}
          refreshMs={market === "forex" ? 60_000 : 0}
          fill
          className="h-full min-h-0 flex-1"
        />

        <ChartTradeOverlay
          recommendation={recommendation}
          riskReward={riskReward}
          isAnalyzing={isAnalyzing}
          liveAnalysis={liveAnalysis}
          drawings={drawings}
          onHighlightDrawing={setHighlightDrawingIndex}
          onStopLive={stopLiveAnalysis}
          onRequestRecommendation={
            onRequestChatMessage
              ? () =>
                  onRequestChatMessage(
                    recommendation
                      ? `نفّذ توصية ${recommendation.action} على ${symbol} — entry ${recommendation.entry ?? "—"} SL ${recommendation.stop_loss ?? "—"} TP ${recommendation.take_profit ?? "—"}`
                      : `أعطني توصية تداول على ${symbol} ${interval} بناءً على التحليل الحالي على الشارت`,
                  )
              : undefined
          }
        />
      </div>
    </div>
  );
}
