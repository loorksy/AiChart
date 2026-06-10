"use client";

import { cn } from "@/lib/utils";

const INTERVALS = ["15m", "1h", "4h", "1d", "1w"] as const;

export function MarketIntervalTabs({
  value,
  onChange,
  compact = false,
}: {
  value: string;
  onChange: (interval: string) => void;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "market-segment inline-flex shrink-0 items-center rounded-lg border border-border/50 bg-background/80 p-0.5 backdrop-blur-md",
        compact ? "h-8" : "h-11 min-h-[44px] rounded-xl border-border bg-card p-1",
      )}
      role="tablist"
      aria-label="الإطار الزمني"
    >
      {INTERVALS.map((iv) => {
        const active = value === iv;
        return (
          <button
            key={iv}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(iv)}
            className={cn(
              "inline-flex items-center justify-center rounded-md font-medium transition",
              compact
                ? "h-7 min-w-[2rem] px-1.5 text-[10px]"
                : "h-9 min-w-[44px] rounded-lg px-3 text-xs",
              active
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {iv}
          </button>
        );
      })}
    </div>
  );
}
