"use client";

import { cn } from "@/lib/utils";

export interface HeatmapCell {
  symbol: string;
  historicalPnl: number;
  trades: number;
  winRate: number;
  changePct24h: number;
  price: number | null;
}

function pnlColor(pnl: number): string {
  if (pnl > 50) return "bg-green-500/40";
  if (pnl > 0) return "bg-green-500/20";
  if (pnl < -50) return "bg-red-500/40";
  if (pnl < 0) return "bg-red-500/20";
  return "bg-secondary/60";
}

function changeBorder(change: number): string {
  if (change >= 2) return "ring-2 ring-green-500/60";
  if (change <= -2) return "ring-2 ring-red-500/60";
  return "ring-1 ring-border/50";
}

export function HeatmapGrid({ cells }: { cells: HeatmapCell[] }) {
  if (!cells.length) {
    return (
      <p className="text-sm text-muted-foreground">لا توجد رموز في قائمة المراقبة.</p>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
      {cells.map((c) => (
        <div
          key={c.symbol}
          className={cn(
            "rounded-lg p-2 text-center transition",
            pnlColor(c.historicalPnl),
            changeBorder(c.changePct24h),
          )}
        >
          <p className="text-xs font-semibold" dir="ltr">
            {c.symbol}
          </p>
          <p
            className={cn(
              "mt-1 text-[10px] tabular-nums",
              c.changePct24h >= 0 ? "text-green-600" : "text-red-500",
            )}
            dir="ltr"
          >
            {c.changePct24h >= 0 ? "+" : ""}
            {c.changePct24h.toFixed(1)}%
          </p>
          <p className="mt-0.5 text-[10px] text-muted-foreground tabular-nums" dir="ltr">
            PnL {c.historicalPnl.toFixed(0)}
          </p>
        </div>
      ))}
    </div>
  );
}
