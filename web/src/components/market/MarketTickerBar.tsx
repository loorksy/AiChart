"use client";

import { Sparkles, TrendingDown, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatTickerPrice } from "./formatLevel";
import { useEaLivePrice } from "@/hooks/useEaLivePrice";

const BTN =
  "inline-flex h-11 min-h-[44px] shrink-0 items-center justify-center gap-2 rounded-xl px-3 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function MarketTickerBar({
  symbol,
  onAnalyze,
  isAnalyzing,
}: {
  symbol: string;
  onAnalyze: () => void;
  isAnalyzing: boolean;
}) {
  const tick = useEaLivePrice(symbol);
  const up = tick.price > 0 ? tick.direction !== "down" : null;

  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-3">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-lg font-semibold tracking-tight" dir="ltr">
          {symbol}
        </span>
        {tick.price > 0 ? (
          <>
            <span
              className="text-xl font-semibold tabular-nums text-foreground"
              dir="ltr"
            >
              {formatTickerPrice(tick.price)}
            </span>
            {tick.direction ? (
              <span
                className={cn(
                  "inline-flex items-center gap-1 text-sm font-medium tabular-nums",
                  up ? "text-green-500" : "text-red-500",
                )}
                dir="ltr"
              >
                {up ? (
                  <TrendingUp className="h-3.5 w-3.5" aria-hidden />
                ) : (
                  <TrendingDown className="h-3.5 w-3.5" aria-hidden />
                )}
                live
              </span>
            ) : null}
          </>
        ) : (
          <span className="text-sm text-muted-foreground">—</span>
        )}
      </div>

      <button
        type="button"
        onClick={onAnalyze}
        disabled={isAnalyzing}
        className={cn(
          BTN,
          "border border-primary/40 text-primary hover:bg-primary/10",
          isAnalyzing && "opacity-60",
        )}
        aria-label="تحليل الشارت بالذكاء الاصطناعي"
      >
        <Sparkles className="h-4 w-4" />
        <span className="hidden sm:inline">تحليل</span>
      </button>
    </div>
  );
}
