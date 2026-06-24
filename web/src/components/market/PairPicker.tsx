"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  Search,
  TrendingUp,
  TrendingDown,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { forexCanonicalKey } from "@/lib/mt5SymbolMap";
import { prefetchKlines } from "@/lib/ohlc/klinesClientCache";

type Market = "crypto" | "forex";
interface Ticker {
  price: number;
  changePct: number;
}

/** Popular defaults shown first (before the full searchable list loads). */
const POPULAR_CRYPTO = [
  "BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "DOGEUSDT",
  "ADAUSDT", "AVAXUSDT", "LINKUSDT", "DOTUSDT", "TRXUSDT", "LTCUSDT",
];
const FOREX_MAJORS = [
  "EURUSD", "GBPUSD", "USDJPY", "AUDUSD", "USDCAD", "USDCHF",
  "NZDUSD", "EURGBP", "EURJPY", "GBPJPY", "XAUUSD", "XAGUSD",
];

function fmtPrice(p: number): string {
  if (!p) return "—";
  if (p >= 1000) return p.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (p >= 1) return p.toFixed(2);
  return p.toFixed(5);
}

function prettyPair(symbol: string, market: Market): string {
  if (market === "crypto") return symbol.replace(/USDT$/, "/USDT");
  return symbol.length === 6 ? `${symbol.slice(0, 3)}/${symbol.slice(3)}` : symbol;
}

/**
 * Symbol selector — a button that opens a popover of pair cards (live price +
 * 24h change for crypto, major pairs for forex), with search. Replaces the
 * free-text symbol input.
 */
export function PairPicker({
  market,
  value,
  onChange,
  className,
  placement = "down",
  interval = "1h",
}: {
  market: Market;
  value: string;
  onChange: (symbol: string) => void;
  className?: string;
  placement?: "up" | "down";
  interval?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [tickers, setTickers] = useState<Record<string, Ticker>>({});
  const [forexSymbols, setForexSymbols] = useState<string[]>(FOREX_MAJORS);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  // Load crypto tickers when the popover opens (forex has no live ticker feed).
  useEffect(() => {
    if (!open || market !== "crypto" || Object.keys(tickers).length) return;
    void fetch("/api/market/tickers", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : {}))
      .then((d) => setTickers(d ?? {}))
      .catch(() => {});
  }, [open, market, tickers]);

  // Load broker forex symbols when the popover opens.
  useEffect(() => {
    if (!open || market !== "forex") return;
    void fetch("/api/instruments?market=forex&wrapped=1", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const rows = (d?.instruments ?? []) as Array<{ symbol: string }>;
        if (rows.length) {
          setForexSymbols(rows.map((r) => r.symbol.toUpperCase()));
        }
      })
      .catch(() => {});
  }, [open, market]);

  const list = useMemo(() => {
    const q = query.trim().toUpperCase().replace("/", "");
    if (market === "forex") {
      const canonicalQ = q ? forexCanonicalKey(q) : "";
      return forexSymbols
        .filter(
          (s) =>
            !q ||
            s.includes(q) ||
            (canonicalQ && forexCanonicalKey(s) === canonicalQ),
        )
        .slice(0, 80)
        .map((s) => ({
          symbol: s,
          price: 0,
          changePct: 0,
        }));
    }
    const all = Object.keys(tickers);
    const base = all.length ? all : POPULAR_CRYPTO;
    const filtered = q
      ? base.filter((s) => s.includes(q)).slice(0, 60)
      : // No query: popular first, then the rest by 24h move.
        [
          ...POPULAR_CRYPTO.filter((s) => tickers[s] || !all.length),
          ...all
            .filter((s) => !POPULAR_CRYPTO.includes(s))
            .sort(
              (a, b) =>
                Math.abs(tickers[b]?.changePct ?? 0) -
                Math.abs(tickers[a]?.changePct ?? 0),
            )
            .slice(0, 24),
        ];
    return filtered.map((s) => ({
      symbol: s,
      price: tickers[s]?.price ?? 0,
      changePct: tickers[s]?.changePct ?? 0,
    }));
  }, [market, query, tickers, forexSymbols]);

  const selected = value?.trim().toUpperCase();
  const selTicker = selected ? tickers[selected] : undefined;

  const panelBody = (
    <>
      <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2.5">
        <Search className="h-4 w-4 text-muted-foreground" />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={market === "forex" ? "ابحث (EURUSD…)" : "ابحث (BTC…)"}
          className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          dir="ltr"
        />
        {query && (
          <button type="button" onClick={() => setQuery("")}>
            <X className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
        )}
      </div>
      <div className="grid max-h-64 grid-cols-2 gap-1.5 overflow-y-auto p-2">
        {list.length === 0 && (
          <p className="col-span-2 py-6 text-center text-xs text-muted-foreground">
            لا نتائج
          </p>
        )}
        {list.map((p) => {
          const isSel = p.symbol === selected;
          const up = p.changePct >= 0;
          return (
            <button
              key={p.symbol}
              type="button"
              onMouseEnter={() =>
                prefetchKlines(p.symbol, interval, market, 120)
              }
              onClick={() => {
                onChange(p.symbol);
                setOpen(false);
                setQuery("");
              }}
              className={cn(
                "flex flex-col gap-1 rounded-lg border p-2.5 text-right transition",
                isSel
                  ? "border-primary/50 bg-primary/10"
                  : "border-border/60 bg-background/40 hover:border-primary/30 hover:bg-secondary/40",
              )}
            >
              <span className="font-mono text-xs font-semibold text-foreground" dir="ltr">
                {prettyPair(p.symbol, market)}
              </span>
              {market === "crypto" && (
                <span className="flex items-center justify-between gap-1">
                  <span
                    className={cn(
                      "flex items-center gap-0.5 text-[10px] font-medium",
                      up ? "text-emerald-500" : "text-rose-500",
                    )}
                  >
                    {up ? (
                      <TrendingUp className="h-2.5 w-2.5" />
                    ) : (
                      <TrendingDown className="h-2.5 w-2.5" />
                    )}
                    {p.changePct ? `${up ? "+" : ""}${p.changePct.toFixed(1)}%` : ""}
                  </span>
                  <span className="font-mono text-[10px] text-muted-foreground" dir="ltr">
                    {fmtPrice(p.price)}
                  </span>
                </span>
              )}
            </button>
          );
        })}
      </div>
    </>
  );

  return (
    <div ref={ref} className={cn("relative", className)}>
      {/* Trigger */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 rounded-xl border border-border bg-card px-3 py-2.5 text-sm transition hover:border-primary/40"
      >
        {selected ? (
          <span className="flex items-center gap-2">
            <span className="font-mono font-semibold text-foreground" dir="ltr">
              {prettyPair(selected, market)}
            </span>
            {selTicker && (
              <span
                className={cn(
                  "rounded px-1.5 py-0.5 text-[10px] font-medium",
                  selTicker.changePct >= 0
                    ? "bg-emerald-500/10 text-emerald-500"
                    : "bg-rose-500/10 text-rose-500",
                )}
              >
                {selTicker.changePct >= 0 ? "+" : ""}
                {selTicker.changePct.toFixed(2)}%
              </span>
            )}
          </span>
        ) : (
          <span className="text-muted-foreground">اختر الزوج…</span>
        )}
        <ChevronDown
          className={cn("h-4 w-4 text-muted-foreground transition", open && "rotate-180")}
        />
      </button>

      {open && (
        <>
          {/* Mobile: centered modal */}
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 md:hidden">
            <button
              type="button"
              className="absolute inset-0 bg-black/60"
              aria-label="إغلاق"
              onClick={() => setOpen(false)}
            />
            <div className="relative flex max-h-[70vh] w-full max-w-sm flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
              {panelBody}
            </div>
          </div>

          {/* Desktop: popover */}
          <div
            className={cn(
              "absolute z-50 hidden w-full min-w-[16rem] overflow-hidden rounded-xl border border-border bg-card shadow-xl md:block",
              placement === "up" ? "bottom-full mb-2" : "top-full mt-2",
            )}
          >
            {panelBody}
          </div>
        </>
      )}
    </div>
  );
}
