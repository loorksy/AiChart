"use client";

import { cn } from "@/lib/utils";

const INTERVALS = ["15m", "1h", "4h", "1d", "1w"] as const;

export function MarketIntervalTabs({
  value,
  onChange,
}: {
  value: string;
  onChange: (interval: string) => void;
}) {
  return (
    <div
      className="market-segment inline-flex h-11 min-h-[44px] shrink-0 items-center rounded-xl border border-border bg-card p-1"
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
              "inline-flex h-9 min-w-[44px] items-center justify-center rounded-lg px-3 text-xs font-medium transition",
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
