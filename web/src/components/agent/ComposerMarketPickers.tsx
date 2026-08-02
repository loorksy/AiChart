"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Clock3, Search } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { ComposerPopover } from "@/components/agent/ComposerPopover";
import { cn } from "@/lib/utils";

interface InstrumentRow {
  symbol: string;
  description?: string;
}

const TRIGGER_CLASS =
  "flex min-h-11 shrink-0 items-center gap-1 rounded-lg px-2 text-xs font-semibold tabular-nums transition-colors duration-150 ease-out sm:min-h-9 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

const ROW_CLASS =
  "flex min-h-11 w-full items-center justify-between gap-2 rounded-lg px-2.5 text-start text-xs transition-colors hover:bg-muted sm:min-h-9";

/**
 * The pair the next question is about, chosen where the question is typed.
 *
 * The list is the account's own reality: a broker account connected through
 * the EA or MetaAPI trades the broker's symbols, so that is what it is offered;
 * everyone else gets the OANDA universe the platform charts from. Search hits
 * the same /api/instruments endpoint the chart's own symbol search uses — one
 * catalogue, two doors.
 */
export function ComposerSymbolPicker({
  symbol,
  brokerConnected,
  onSelect,
}: {
  symbol: string;
  brokerConnected: boolean;
  onSelect: (symbol: string, source: "oanda" | "ea") => void;
}) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<InstrumentRow[]>([]);
  const [loading, setLoading] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const source: "oanda" | "ea" = brokerConnected ? "ea" : "oanda";

  useEffect(() => {
    if (!open) return;
    const handle = window.setTimeout(() => {
      setLoading(true);
      const params = new URLSearchParams({ wrapped: "1" });
      if (source === "ea") params.set("source", "ea");
      if (query.trim()) params.set("q", query.trim());
      fetch(`/api/instruments?${params}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { instruments?: InstrumentRow[] } | null) => {
          if (d?.instruments) setRows(d.instruments.slice(0, 60));
        })
        .catch(() => {})
        .finally(() => setLoading(false));
      // Debounced: one request per pause in typing, not one per keystroke.
    }, 250);
    return () => window.clearTimeout(handle);
  }, [open, query, source]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={t("trades.col.symbol")}
        title={t("trades.col.symbol")}
        data-testid="composer-symbol"
        className={cn(
          TRIGGER_CLASS,
          open ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
        )}
      >
        <span dir="ltr">{symbol}</span>
        <ChevronDown className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
      </button>

      <ComposerPopover
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={triggerRef}
        title={t("trades.col.symbol")}
      >
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("chats.search_placeholder")}
            aria-label={t("chats.search_placeholder")}
            className="min-h-9 w-full bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground"
            dir="ltr"
          />
        </div>
        <div className="max-h-[min(50vh,18rem)] overflow-y-auto p-1" aria-busy={loading}>
          {rows.map((row) => (
            <button
              key={row.symbol}
              type="button"
              onClick={() => {
                onSelect(row.symbol, source);
                setOpen(false);
              }}
              className={cn(ROW_CLASS, row.symbol === symbol && "font-semibold")}
            >
              <span dir="ltr">{row.symbol}</span>
              <span className="flex items-center gap-2">
                {row.description ? (
                  <span className="max-w-[10rem] truncate text-[10px] text-muted-foreground" dir="ltr">
                    {row.description}
                  </span>
                ) : null}
                {row.symbol === symbol && <Check className="h-3.5 w-3.5 shrink-0" aria-hidden />}
              </span>
            </button>
          ))}
          {!loading && rows.length === 0 && (
            <p className="px-3 py-4 text-center text-xs text-muted-foreground">
              {t("journal.filter.none")}
            </p>
          )}
        </div>
      </ComposerPopover>
    </>
  );
}

/** The intervals the chart itself understands — same table TvChart maps from. */
const INTERVALS = ["1m", "5m", "15m", "30m", "1h", "4h", "1d"] as const;

export function ComposerIntervalPicker({
  interval,
  onSelect,
}: {
  interval: string;
  onSelect: (interval: string) => void;
}) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={t("layout.chart")}
        data-testid="composer-interval"
        className={cn(
          TRIGGER_CLASS,
          open ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
        )}
      >
        <Clock3 className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span dir="ltr">{interval}</span>
      </button>

      <ComposerPopover
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={triggerRef}
        title={t("layout.chart")}
      >
        <div className="grid grid-cols-4 gap-1 p-2">
          {INTERVALS.map((iv) => (
            <button
              key={iv}
              type="button"
              onClick={() => {
                onSelect(iv);
                setOpen(false);
              }}
              className={cn(
                "flex min-h-11 items-center justify-center rounded-lg text-xs tabular-nums transition-colors hover:bg-muted sm:min-h-9",
                iv === interval
                  ? "bg-muted font-semibold text-foreground"
                  : "text-muted-foreground",
              )}
              dir="ltr"
            >
              {iv}
            </button>
          ))}
        </div>
      </ComposerPopover>
    </>
  );
}
