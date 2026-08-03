"use client";

import { TrendingDown, TrendingUp } from "lucide-react";
import { useEaLivePrice } from "@/hooks/useEaLivePrice";
import type { LivePriceTick } from "@/hooks/livePriceTypes";
import { formatTickerPrice } from "@/components/market/formatLevel";
import { cn } from "@/lib/utils";

export function ChartLivePriceBadge({
  symbol,
  live: liveProp,
  className,
}: {
  symbol: string;
  live?: LivePriceTick;
  className?: string;
}) {
  const fromHook = useEaLivePrice(liveProp ? "" : symbol, !liveProp);
  const live = liveProp ?? fromHook;
  const up = live.changePct >= 0;
  const hasPrice = live.price > 0;

  return (
    <div
      className={cn(
        "pointer-events-none absolute bottom-10 left-2 z-50 rounded-lg border border-border/50 bg-background/95 px-2 py-1.5 shadow-md backdrop-blur-md",
        live.direction === "up" && "ring-1 ring-green-500/40",
        live.direction === "down" && "ring-1 ring-red-500/40",
        className,
      )}
      dir="ltr"
      aria-live="polite"
      aria-atomic
    >
      <p className="text-[10px] font-medium text-muted-foreground">{symbol}</p>
      <p
        className={cn(
          "text-sm font-semibold tabular-nums transition-colors duration-75",
          live.direction === "up" && "text-green-500",
          live.direction === "down" && "text-red-500",
          !live.direction && "text-foreground",
        )}
      >
        {hasPrice ? formatTickerPrice(live.price) : "—"}
      </p>
      {hasPrice && live.changePct !== 0 && (
        <span
          className={cn(
            "inline-flex items-center gap-0.5 text-[10px] font-medium tabular-nums",
            up ? "text-green-500" : "text-red-500",
          )}
        >
          {up ? (
            <TrendingUp className="h-3 w-3" aria-hidden />
          ) : (
            <TrendingDown className="h-3 w-3" aria-hidden />
          )}
          {up ? "+" : ""}
          {live.changePct.toFixed(2)}%
        </span>
      )}
      {/*
        The spread, beside the price it applies to. On a linked cloud account
        this is the trader's OWN broker book — the cost their next order pays —
        so the source is named rather than left to be assumed.
      */}
      {hasPrice && live.spreadLabel && live.spreadLabel !== "—" && (
        <p className="mt-0.5 text-[10px] tabular-nums text-muted-foreground">
          <span className="opacity-70">سبريد</span> {live.spreadLabel}
          {live.source === "metaapi" && (
            <span className="ms-1 rounded-sm bg-muted px-1 text-[9px] opacity-80">
              وسيطك
            </span>
          )}
        </p>
      )}
      {!live.connected && hasPrice && (
        <span className="ms-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" />
      )}
    </div>
  );
}
