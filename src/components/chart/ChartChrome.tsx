"use client";

import { RefreshCw } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import type { TvHeaderAction } from "@/components/chart/TvChart";
import { cn } from "@/lib/utils";

const INTERVALS: { value: string; label: string }[] = [
  { value: "1m", label: "1m" },
  { value: "5m", label: "5m" },
  { value: "15m", label: "15m" },
  { value: "1h", label: "1H" },
  { value: "4h", label: "4H" },
  { value: "1d", label: "1D" },
];

/**
 * Platform chrome that replaced the TradingView top toolbar (N2 / N14).
 *
 * Survivors from the TV header live here: the pair spelling (broker case when
 * cloud), the interval control, relocated header actions, and (Phase 4) refresh.
 */
export function ChartChrome({
  symbol,
  interval,
  actions,
  onIntervalChange,
  onRefresh,
  className,
}: {
  symbol: string;
  interval: string;
  /** Kept for mount-site compatibility; the linked account is the only pipe. */
  dataSource?: "oanda";
  actions?: TvHeaderAction[];
  onIntervalChange?: (interval: string) => void;
  onRefresh?: () => void;
  className?: string;
}) {
  const { t } = useLocale();

  return (
    <div
      data-testid="chart-chrome"
      className={cn(
        "pointer-events-none absolute inset-x-0 top-0 z-30 flex items-start justify-between gap-2 p-2",
        className,
      )}
    >
      <div className="pointer-events-auto flex min-w-0 flex-wrap items-center gap-1.5 rounded-lg border border-border/60 bg-background/90 px-2 py-1 shadow-sm backdrop-blur-md">
        <span
          data-testid="chart-symbol-label"
          className="truncate text-sm font-semibold tabular-nums"
          dir="ltr"
          title={symbol}
        >
          {symbol}
        </span>
        {/* The user's own MetaTrader account is the only data pipe. */}
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          MT5
        </span>
        <span className="mx-0.5 h-3 w-px bg-border" aria-hidden />
        <div className="flex items-center gap-0.5" role="group" aria-label={t("layout.timeframe")}>
          {INTERVALS.map((item) => (
            <button
              key={item.value}
              type="button"
              data-testid={`chart-interval-${item.value}`}
              data-active={interval === item.value ? "true" : "false"}
              onClick={() => onIntervalChange?.(item.value)}
              className={cn(
                "rounded px-1.5 py-0.5 text-[11px] font-semibold tabular-nums transition-colors",
                interval === item.value
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
        {onRefresh && (
          <button
            type="button"
            data-testid="chart-refresh"
            onClick={onRefresh}
            aria-label={t("shell.refresh")}
            className="ms-0.5 flex size-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
          </button>
        )}
      </div>

      {actions && actions.length > 0 && (
        <div className="pointer-events-auto flex max-w-[55%] flex-wrap items-center justify-end gap-1">
          {actions.map((action) => (
            <button
              key={action.id}
              type="button"
              title={action.title}
              onClick={action.onClick}
              disabled={!action.onClick}
              className={cn(
                "rounded-md border border-border/60 bg-background/90 px-2 py-1 text-[11px] font-semibold shadow-sm backdrop-blur-md transition-colors",
                action.onClick
                  ? "hover:bg-muted"
                  : "cursor-default opacity-80",
              )}
              style={action.color ? { color: action.color } : undefined}
            >
              {action.text}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
