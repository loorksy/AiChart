"use client";

import { Loader2, Maximize2, Minimize2, Search, Sparkles } from "lucide-react";
import { MarketIntervalTabs } from "@/components/market/MarketIntervalTabs";
import { cn } from "@/lib/utils";

const CTRL =
  "inline-flex h-8 items-center justify-center gap-1 rounded-lg border border-border/50 bg-background/80 text-xs font-medium text-foreground backdrop-blur-md transition hover:bg-background/95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function ChartOverlayToolbar({
  openAssets,
  search,
  onSearchChange,
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
}: {
  openAssets: boolean;
  search: string;
  onSearchChange: (v: string) => void;
  symbol: string;
  onSymbolChange: (v: string) => void;
  pickerOptions: { symbol: string }[];
  loadingInstruments: boolean;
  interval: string;
  onIntervalChange: (v: string) => void;
  isAnalyzing: boolean;
  onAnalyze: () => void;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
}) {
  return (
    <div className="pointer-events-none absolute inset-x-2 top-2 z-10 flex flex-wrap items-center gap-1.5">
      {openAssets && (
        <div className="pointer-events-auto relative">
          <Search className="absolute start-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
          <input
            className={cn(CTRL, "h-8 w-28 ps-7 pe-2 text-[11px]")}
            placeholder="ابحث…"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            dir="ltr"
            aria-label="بحث عن زوج"
          />
        </div>
      )}

      <select
        className={cn(CTRL, "pointer-events-auto h-8 max-w-[7rem] px-2 text-[11px]")}
        value={symbol}
        onChange={(e) => onSymbolChange(e.target.value)}
        dir="ltr"
        aria-label="اختيار الزوج"
      >
        {pickerOptions.length === 0 && <option value={symbol}>{symbol}</option>}
        {pickerOptions.map((inst) => (
          <option key={inst.symbol} value={inst.symbol}>
            {inst.symbol}
          </option>
        ))}
      </select>

      {openAssets && loadingInstruments && (
        <Loader2 className="pointer-events-auto h-3.5 w-3.5 animate-spin text-muted-foreground" />
      )}

      <div className="pointer-events-auto">
        <MarketIntervalTabs compact value={interval} onChange={onIntervalChange} />
      </div>

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
