"use client";

import { CandlestickChart } from "lucide-react";
import type { MarketType } from "@/lib/markets/types";
import { cn } from "@/lib/utils";

const OPTIONS: { id: MarketType; label: string; icon: typeof CandlestickChart }[] = [
  { id: "forex", label: "فوركس", icon: CandlestickChart },
];

/** Forex-only market selector (single option for layout compatibility). */
export function MarketTypeSelector({
  value,
  onChange,
  className,
}: {
  value: MarketType;
  onChange: (m: MarketType) => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "pointer-events-auto inline-flex h-8 items-center gap-0.5 rounded-lg border border-border/50 bg-background/80 p-0.5 backdrop-blur-md",
        className,
      )}
      role="tablist"
      aria-label="نوع السوق"
    >
      {OPTIONS.map((opt) => {
        const Icon = opt.icon;
        const active = opt.id === value;
        return (
          <button
            key={opt.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.id)}
            className={cn(
              "inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium transition",
              active
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            <span>{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}
