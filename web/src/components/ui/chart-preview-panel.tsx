"use client";

import { X, Maximize2, Minimize2 } from "lucide-react";
import PriceChart from "@/components/PriceChart";
import { IntervalPicker } from "@/components/market/IntervalPicker";
import type { Recommendation } from "@/lib/types";
import { cn } from "@/lib/utils";

export function ChartPreviewPanel({
  symbol,
  interval,
  onIntervalChange,
  recommendations,
  onClose,
  expanded,
  onToggleExpand,
  className,
}: {
  symbol: string;
  interval: string;
  onIntervalChange: (iv: string) => void;
  recommendations: Recommendation[];
  onClose?: () => void;
  expanded?: boolean;
  onToggleExpand?: () => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex h-full flex-col border-r border-border bg-card/95 backdrop-blur-sm",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">معاينة</span>
          <span
            className="rounded-md bg-secondary px-2 py-0.5 font-mono text-sm font-semibold text-foreground"
            dir="ltr"
          >
            {symbol}
          </span>
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
          refreshMs={5000}
          className="h-full min-h-0 flex-1"
        />
      </div>
    </div>
  );
}
