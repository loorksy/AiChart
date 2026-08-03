"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Lock, Search, X } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { useSheetGesture } from "@/hooks/useSheetGesture";
import { PairFlags } from "@/components/agent/CurrencyFlag";
import { DataSourceMenuButton } from "@/components/agent/DataSourceChoice";
import { forexBaseQuote } from "@/lib/markets/forexInstruments";
import { getSessionStatus } from "@/lib/markets/tradingCalendar";
import {
  formatChangePct,
  formatPairPrice,
  sparklineGeometry,
  type PairQuote,
} from "@/lib/markets/pairQuote";
import { CardGridSkeleton } from "@/components/ui/skeletons/page-skeletons";
import { cn } from "@/lib/utils";

interface InstrumentRow {
  symbol: string;
  description?: string;
  /** Server's verdict on the session; the card falls back to its own clock. */
  market_open?: boolean;
}

/** The two pipes a pair list can come from. */
type MarketSource = "oanda" | "metaapi";

interface InstrumentsResponse {
  instruments?: InstrumentRow[];
  /** What the server actually served — the client never assumes. */
  source?: string;
}

function normalizeSource(raw: string | undefined): MarketSource {
  return raw === "metaapi" ? "metaapi" : "oanda";
}

/** Matches the server's per-request cap, so one flush is one request. */
const QUOTE_BATCH = 12;
/**
 * Cards rendered per page. The catalogue is served whole — an OANDA account
 * lists ~70 pairs, a broker account can list thousands — so it is revealed a
 * page at a time as the user scrolls rather than truncated to a first slice
 * that would put the rest out of reach of anything but search.
 */
const PAGE_SIZE = 60;
const SPARK_W = 140;
const SPARK_H = 34;

/**
 * The pair catalogue, as cards.
 *
 * A row of ticker codes tells a trader nothing they can scan: the pairs they
 * are choosing between differ by where the price is and which way it has been
 * going, and that is exactly what a list of six-letter codes hides. Every pair
 * is a card carrying its flags, its rate, its day's move and the shape of that
 * move — the same anatomy a currency card has anywhere else on a phone.
 *
 * Two columns on a phone, four on a desktop; quotes load per card as it scrolls
 * into view, so opening the catalogue costs a screenful of requests, not sixty.
 */
export function SymbolPickerSheet({
  open,
  onClose,
  symbol,
  brokerConnected,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  symbol: string;
  brokerConnected: boolean;
  onSelect: (symbol: string, source: MarketSource) => void;
}) {
  const { t, dir } = useLocale();
  const [mounted, setMounted] = useState(false);
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<InstrumentRow[]>([]);
  const [visible, setVisible] = useState(PAGE_SIZE);
  /** Bumped when the operator switches source, to re-ask for the catalogue. */
  const [sourceVersion, setSourceVersion] = useState(0);
  const [loading, setLoading] = useState(false);
  const [quotes, setQuotes] = useState<Record<string, PairQuote>>({});
  const panelRef = useRef<HTMLDivElement>(null);
  // The client does not choose the pipe. Two can serve the same pair — the
  // platform feed, or the trader's own cloud account — and which one is
  // connected and preferred is the server's call. It answers with the
  // source it really used, and that is what gets displayed and passed on.
  void brokerConnected;
  const [served, setServed] = useState<MarketSource>("oanda");

  useEffect(() => setMounted(true), []);

  const { handleProps } = useSheetGesture({ sheetRef: panelRef, onDismiss: onClose });

  // Reset between openings: a stale query would hide the pair the user came for.
  useEffect(() => {
    if (open) return;
    setQuery("");
    setRows([]);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handle = window.setTimeout(() => {
      setLoading(true);
      const params = new URLSearchParams({ wrapped: "1" });
      if (query.trim()) params.set("q", query.trim());
      fetch(`/api/instruments?${params}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((d: InstrumentsResponse | null) => {
          setRows(d?.instruments ?? []);
          setVisible(PAGE_SIZE);
          setServed(normalizeSource(d?.source));
        })
        .catch(() => setRows([]))
        .finally(() => setLoading(false));
      // Debounced: one request per pause in typing, not one per keystroke.
    }, 250);
    return () => window.clearTimeout(handle);
  }, [open, query, sourceVersion]);

  // --- Quote loading -------------------------------------------------------
  // Cards ask for their own quote when they scroll into view; the asks are
  // batched so a screenful of cards costs one request.
  const askedFor = useRef<Set<string>>(new Set());
  const pending = useRef<string[]>([]);
  const flushTimer = useRef<number | null>(null);

  const draining = useRef(false);

  /** Drains the queue a batch at a time — one request in flight, never twelve. */
  const drain = useCallback(async () => {
    flushTimer.current = null;
    if (draining.current) return;
    draining.current = true;
    try {
      while (pending.current.length > 0) {
        const batch = pending.current.splice(0, QUOTE_BATCH);
        const params = new URLSearchParams({ symbols: batch.join(",") });
        if (served !== "oanda") params.set("source", served);
        try {
          const res = await fetch(`/api/instruments/quotes?${params}`, { cache: "no-store" });
          if (!res.ok) continue;
          const data = (await res.json()) as { quotes?: PairQuote[] };
          if (!data.quotes?.length) continue;
          setQuotes((prev) => {
            const next = { ...prev };
            for (const q of data.quotes!) next[q.symbol] = q;
            return next;
          });
        } catch {
          /* this batch stays unquoted; the rest still load */
        }
      }
    } finally {
      draining.current = false;
    }
  }, [served]);

  const enqueue = useCallback(
    (sym: string) => {
      if (askedFor.current.has(sym)) return;
      askedFor.current.add(sym);
      pending.current.push(sym);
      if (flushTimer.current == null) {
        flushTimer.current = window.setTimeout(() => void drain(), 120);
      }
    },
    [drain],
  );

  // A new result set is a new set of symbols — and a new SOURCE is new prices
  // for the same ones. Either way, forget what was in flight rather than
  // merging two markets' quotes into one grid.
  useEffect(() => {
    askedFor.current.clear();
    pending.current = [];
    setQuotes({});
  }, [sourceVersion]);

  useEffect(() => {
    if (!open) {
      askedFor.current.clear();
      pending.current = [];
      if (flushTimer.current != null) {
        window.clearTimeout(flushTimer.current);
        flushTimer.current = null;
      }
      setQuotes({});
    }
  }, [open]);

  const cards = useRef<Map<string, HTMLElement>>(new Map());
  const registerCard = useCallback((sym: string, el: HTMLElement | null) => {
    if (el) cards.current.set(sym, el);
    else cards.current.delete(sym);
  }, []);

  // Child refs are attached before this effect runs, so every card mounted for
  // the current result set is already in the map by the time it observes them.
  useEffect(() => {
    if (!open || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const sym = (entry.target as HTMLElement).dataset.symbol;
          if (sym) enqueue(sym);
          io.unobserve(entry.target);
        }
      },
      { rootMargin: "160px" },
    );
    for (const el of cards.current.values()) io.observe(el);
    return () => io.disconnect();
  }, [open, rows, visible, enqueue]);

  // Reaching the end of the rendered page reveals the next one, so a broker
  // account with hundreds of symbols is reachable by scrolling, not only by
  // searching for a name the trader would have to know already.
  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!open || !el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible((current) => Math.min(current + PAGE_SIZE, rows.length));
        }
      },
      { rootMargin: "240px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [open, rows.length, visible]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const sourceNote = useMemo(() => {
    if (served === "metaapi") return t("symbol.picker.source_cloud");
    return t("symbol.picker.source_platform");
  }, [served, t]);

  if (!mounted || !open) return null;

  return createPortal(
    <div
      dir={dir}
      className="fixed inset-0 z-[160] flex items-end justify-center lg:items-center lg:p-6"
    >
      <button
        type="button"
        tabIndex={-1}
        aria-hidden
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-black/55 duration-200 animate-in fade-in motion-reduce:animate-none"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={t("symbol.picker.title")}
        data-testid="symbol-picker"
        className={cn(
          "relative flex w-full flex-col overflow-hidden border border-border bg-background text-foreground shadow-2xl",
          // Phone: a sheet off the bottom edge, tall enough to browse.
          "h-[88dvh] rounded-t-2xl duration-250 animate-in slide-in-from-bottom-6 ease-out",
          // Desktop: a centred dialog wide enough for four columns.
          "lg:h-auto lg:max-h-[80vh] lg:max-w-5xl lg:rounded-2xl lg:slide-in-from-bottom-0 lg:zoom-in-95",
          "motion-reduce:animate-none",
        )}
      >
        {/* Grab handle — phones only; a desktop dialog is dismissed by its X. */}
        <div
          {...handleProps}
          data-testid="symbol-picker-handle"
          className="flex shrink-0 cursor-grab justify-center pt-2 active:cursor-grabbing lg:hidden"
        >
          <span className="h-1 w-10 rounded-full bg-muted-foreground/40" />
        </div>

        <div className="flex shrink-0 items-start justify-between gap-3 px-4 pt-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold">{t("symbol.picker.title")}</h2>
            <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
              {sourceNote}
              {rows.length > 0 && (
                <span className="tabular-nums" dir="ltr">
                  {" · "}
                  {rows.length}
                </span>
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("shell.close")}
            className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        {/* Positioned above the grid so the source menu opens OVER the cards
            rather than behind them. */}
        <div className="relative z-20 shrink-0 px-4 pb-3 pt-2">
          <div className="flex items-center gap-2">
            <div className="flex min-w-0 flex-1 items-center gap-2 rounded-full border border-border bg-muted/40 px-3">
              <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("symbol.picker.search")}
                aria-label={t("symbol.picker.search")}
                data-testid="symbol-picker-search"
                className="min-h-11 w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground sm:min-h-10"
                dir="ltr"
              />
            </div>
            {/* The market these pairs come from, beside the box that searches
                them: switching it changes this very list, so the control and
                its effect are in one place. */}
            <DataSourceMenuButton
              enabled={open}
              onChange={() => setSourceVersion((v) => v + 1)}
            />
          </div>
        </div>

        <div
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-[max(1rem,env(safe-area-inset-bottom))]"
          aria-busy={loading}
        >
          {/* First paint of a catalogue — or of a different market after a
              source switch — is the grid's own shape, not an empty box that
              jumps into a grid when the list lands. */}
          {loading && rows.length === 0 && <CardGridSkeleton count={8} />}
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            {rows.slice(0, visible).map((row) => (
              <PairCard
                key={row.symbol}
                row={row}
                quote={quotes[row.symbol]}
                selected={row.symbol === symbol}
                register={registerCard}
                onPick={() => {
                  // The chart must read candles from the same place this list
                  // came from; passing the requested source instead of the
                  // served one is how a mismatch between the list and the
                  // chart's own feed creeps in.
                  onSelect(row.symbol, served);
                  onClose();
                }}
              />
            ))}
          </div>
          <div ref={sentinelRef} aria-hidden className="h-px w-full" />
          {!loading && rows.length === 0 && (
            <p className="px-3 py-10 text-center text-xs text-muted-foreground">
              {t("symbol.picker.none")}
            </p>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function PairCard({
  row,
  quote,
  selected,
  register,
  onPick,
}: {
  row: InstrumentRow;
  quote: PairQuote | undefined;
  selected: boolean;
  register: (symbol: string, el: HTMLElement | null) => void;
  onPick: () => void;
}) {
  const { t } = useLocale();
  const { base, quote: quoteCcy } = forexBaseQuote(row.symbol);
  // The server states the session; the local calendar is the fallback so a card
  // is never mislabelled while its quote is still in flight.
  const session = getSessionStatus(row.symbol);
  const isOpen = row.market_open ?? session.isOpen;
  const pct = quote?.changePct ?? null;
  const up = pct != null && pct >= 0;
  const spark = quote ? sparklineGeometry(quote.series, SPARK_W, SPARK_H) : null;
  const gradientId = `spark-${row.symbol.replace(/[^A-Za-z0-9]/g, "")}`;

  return (
    <button
      type="button"
      ref={(el) => register(row.symbol, el)}
      data-symbol={row.symbol}
      data-testid="pair-card"
      data-selected={selected ? "true" : "false"}
      onClick={onPick}
      data-market-open={isOpen ? "true" : "false"}
      className={cn(
        "group flex flex-col gap-2 overflow-hidden rounded-[var(--radius-lg)] border p-3 text-start transition-colors duration-150",
        selected
          ? "border-foreground/70 bg-muted/60"
          : "border-border bg-card hover:border-foreground/30 hover:bg-muted/40",
        // A closed pair reads as closed at a glance: the whole card fades to
        // grey. It is still selectable — history is legitimate to look at —
        // but nothing about it should suggest a live, analysable market.
        !isOpen && "opacity-55 grayscale",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold" dir="ltr">
            {row.symbol}
          </p>
          <p className="truncate text-[11px] text-muted-foreground">
            {quoteCcy ? `${base} ${t("symbol.card.to")} ${quoteCcy}` : base}
          </p>
        </div>
        <PairFlags symbol={row.symbol} size={20} />
      </div>

      <div className="flex items-baseline gap-1.5" dir="ltr">
        <span className="text-base font-semibold tabular-nums">
          {formatPairPrice(row.symbol, quote?.price ?? null)}
        </span>
        {quoteCcy && (
          <span className="text-[10px] font-medium text-muted-foreground">{quoteCcy}</span>
        )}
      </div>

      <div className="flex items-end justify-between gap-2">
        {isOpen ? (
          <span
            className={cn(
              "text-xs font-semibold tabular-nums",
              pct == null ? "text-muted-foreground" : up ? "text-buy" : "text-sell",
            )}
            dir="ltr"
          >
            {formatChangePct(pct)}
          </span>
        ) : (
          <span
            data-testid="pair-card-closed"
            title={session.reason}
            className="inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground"
          >
            <Lock className="h-2.5 w-2.5" aria-hidden />
            {t("symbol.card.closed")}
          </span>
        )}
        {/* Time runs left to right on a chart in every language. */}
        <span className="text-[10px] text-muted-foreground">{t("symbol.card.window")}</span>
      </div>

      <div className="h-[34px] w-full" dir="ltr">
        {spark ? (
          <svg
            viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
            preserveAspectRatio="none"
            className="h-full w-full"
            aria-hidden
          >
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="0%"
                  stopColor={up ? "var(--buy)" : "var(--sell)"}
                  stopOpacity="0.28"
                />
                <stop
                  offset="100%"
                  stopColor={up ? "var(--buy)" : "var(--sell)"}
                  stopOpacity="0"
                />
              </linearGradient>
            </defs>
            <path d={spark.area} fill={`url(#${gradientId})`} />
            <path
              d={spark.line}
              fill="none"
              stroke={up ? "var(--buy)" : "var(--sell)"}
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        ) : (
          // Not an error — the card simply has not been quoted yet.
          <span className="block h-full w-full rounded bg-muted/50 motion-safe:animate-pulse" />
        )}
      </div>
    </button>
  );
}
