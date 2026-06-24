"use client";

import { useEffect } from "react";
import { X, Maximize2, Minimize2 } from "lucide-react";
import PriceChart from "@/components/PriceChart";
import { IntervalPicker } from "@/components/market/IntervalPicker";
import { PairPicker } from "@/components/market/PairPicker";
import { useBinanceLivePrice } from "@/hooks/useBinanceLivePrice";
import { useEaLivePrice } from "@/hooks/useEaLivePrice";
import { prefetchKlines } from "@/lib/ohlc/klinesClientCache";
import type { Recommendation } from "@/lib/types";
import { cn } from "@/lib/utils";

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
}) {
  const cryptoLive = useBinanceLivePrice(market === "crypto" ? symbol : "");
  const forexLive = useEaLivePrice(symbol, market === "forex");
  const live = market === "forex" ? forexLive : cryptoLive;

  useEffect(() => {
    prefetchKlines(symbol, interval, market);
  }, [symbol, interval, market]);

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
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-2">
        <PriceChart
          symbol={symbol}
          interval={interval}
          recommendations={recommendations}
          market={market}
          livePrice={live.price > 0 ? live.price : undefined}
          liveTick={live}
          refreshMs={market === "forex" ? 60_000 : 0}
          fill
          className="h-full min-h-0 flex-1"
        />
      </div>
    </div>
  );
}
