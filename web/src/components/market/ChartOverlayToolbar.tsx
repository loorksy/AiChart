"use client";

import { EyeOff, Loader2, Maximize2, Minimize2, Sparkles, TrendingDown, TrendingUp } from "lucide-react";
import { formatTickerPrice } from "@/components/market/formatLevel";
import { IntervalPicker } from "@/components/market/IntervalPicker";
import { SymbolPicker, type SymbolOption } from "@/components/market/SymbolPicker";
import type { LivePriceTick } from "@/hooks/useBinanceLivePrice";
import { cn } from "@/lib/utils";

const CTRL =
  "inline-flex h-8 items-center justify-center gap-1 rounded-lg border border-border/50 bg-background/80 text-xs font-medium text-foreground backdrop-blur-md transition hover:bg-background/95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function ChartOverlayToolbar({
  openAssets,
  search,
  onSearchChange,
  onPickerOpen,
  symbol,
  onSymbolChange,
  pickerOptions,
  loadingInstruments,
  interval,
  onIntervalChange,
  isAnalyzing,
  onAnalyze,
  isFullscreen,
  onToggleFullscreen,
  hasChartLayers,
  onClearLayers,
  live,
}: {
  openAssets: boolean;
  search: string;
  onSearchChange: (v: string) => void;
  onPickerOpen?: () => void;
  symbol: string;
  onSymbolChange: (v: string) => void;
  pickerOptions: SymbolOption[];
  loadingInstruments: boolean;
  interval: string;
  onIntervalChange: (v: string) => void;
  isAnalyzing: boolean;
  onAnalyze: () => void;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  hasChartLayers?: boolean;
  onClearLayers?: () => void;
  live?: LivePriceTick;
}) {
  const hasLive = (live?.price ?? 0) > 0;
  const up = (live?.changePct ?? 0) >= 0;

  return (
    <div className="pointer-events-none absolute inset-x-2 top-2 z-20 flex flex-wrap items-center gap-1.5">
      <SymbolPicker
        value={symbol}
        onChange={onSymbolChange}
        options={pickerOptions}
        openAssets={openAssets}
        search={search}
        onSearchChange={onSearchChange}
        loading={openAssets && loadingInstruments}
        onOpen={onPickerOpen}
      />

      {hasLive && live && (
        <div
          className={cn(
            CTRL,
            "pointer-events-none hidden min-w-0 max-w-[9rem] flex-col items-start px-2 py-1 lg:inline-flex",
            live.direction === "up" && "ring-1 ring-green-500/30",
            live.direction === "down" && "ring-1 ring-red-500/30",
          )}
          dir="ltr"
          aria-live="polite"
        >
          <span
            className={cn(
              "w-full truncate text-[11px] font-semibold tabular-nums leading-tight",
              live.direction === "up" && "text-green-500",
              live.direction === "down" && "text-red-500",
              !live.direction && "text-foreground",
            )}
          >
            {formatTickerPrice(live.price)}
          </span>
          <span
            className={cn(
              "inline-flex items-center gap-0.5 text-[9px] font-medium tabular-nums",
              up ? "text-green-500" : "text-red-500",
            )}
          >
            {up ? (
              <TrendingUp className="h-2.5 w-2.5 shrink-0" />
            ) : (
              <TrendingDown className="h-2.5 w-2.5 shrink-0" />
            )}
            {up ? "+" : ""}
            {live.changePct.toFixed(2)}%
          </span>
        </div>
      )}

      <IntervalPicker value={interval} onChange={onIntervalChange} />

      {hasChartLayers && onClearLayers && (
        <button
          type="button"
          onClick={onClearLayers}
          className={cn(CTRL, "pointer-events-auto h-8 w-8 px-0")}
          aria-label="إخفاء الرسم"
          title="إخفاء الرسم"
        >
          <EyeOff className="h-3.5 w-3.5" />
        </button>
      )}

      <button
        type="button"
        onClick={onAnalyze}
        disabled={isAnalyzing}
        className={cn(
          CTRL,
          "pointer-events-auto px-2 text-primary",
          isAnalyzing && "opacity-60",
        )}
        aria-label="تحليل بالذكاء الاصطناعي"
      >
        {isAnalyzing ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Sparkles className="h-3.5 w-3.5" />
        )}
        <span className="hidden sm:inline">تحليل</span>
      </button>

      <button
        type="button"
        onClick={onToggleFullscreen}
        className={cn(CTRL, "pointer-events-auto ms-auto h-8 w-8 shrink-0 px-0")}
        aria-label={isFullscreen ? "الخروج من ملء الشاشة" : "ملء الشاشة"}
      >
        {isFullscreen ? (
          <Minimize2 className="h-3.5 w-3.5" />
        ) : (
          <Maximize2 className="h-3.5 w-3.5" />
        )}
      </button>
    </div>
  );
}
