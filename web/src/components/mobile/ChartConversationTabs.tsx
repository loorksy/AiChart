"use client";

import { cn } from "@/lib/utils";

export interface ChartConversationTab {
  symbol: string;
  timeframe?: string;
  active?: boolean;
}

export function ChartConversationTabs({ tabs, onSelect }: { tabs: ChartConversationTab[]; onSelect?: (symbol: string) => void }) {
  if (!tabs.length) return null;
  return (
    <div className="flex gap-2 overflow-x-auto border-b border-border bg-card/80 px-3 py-2">
      {tabs.map((tab) => (
        <button key={`${tab.symbol}-${tab.timeframe ?? ""}`} type="button" onClick={() => onSelect?.(tab.symbol)} className={cn("shrink-0 rounded-full border px-3 py-1 text-xs", tab.active ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground")}>
          <span dir="ltr">{tab.symbol}</span>{tab.timeframe ? ` · ${tab.timeframe}` : ""}
        </button>
      ))}
    </div>
  );
}
