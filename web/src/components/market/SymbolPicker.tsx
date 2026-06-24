"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Loader2, Search, TrendingDown, TrendingUp, X } from "lucide-react";
import { formatTickerPrice } from "@/components/market/formatLevel";
import { useBinanceLivePrices } from "@/hooks/useBinanceLivePrice";
import type { MarketType } from "@/lib/markets/types";
import { cn } from "@/lib/utils";
import { prefetchKlines } from "@/lib/ohlc/klinesClientCache";

const CTRL =
  "inline-flex h-8 items-center justify-center gap-1 rounded-lg border border-border/50 bg-background/80 text-xs font-medium text-foreground backdrop-blur-md transition hover:bg-background/95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export interface SymbolOption {
  symbol: string;
  base: string;
  quote: string;
}

export function SymbolPicker({
  value,
  onChange,
  options,
  openAssets,
  search,
  onSearchChange,
  loading,
  onOpen,
  market = "crypto",
  interval = "1h",
}: {
  value: string;
  onChange: (symbol: string) => void;
  options: SymbolOption[];
  openAssets: boolean;
  search: string;
  onSearchChange: (q: string) => void;
  loading?: boolean;
  onOpen?: () => void;
  market?: MarketType;
  interval?: string;
}) {
  const isForex = market === "forex";
  const [open, setOpen] = useState(false);
  const [mobile, setMobile] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    if (openAssets) return options;
    const q = search.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) =>
        o.symbol.toLowerCase().includes(q) ||
        o.base.toLowerCase().includes(q),
    );
  }, [openAssets, options, search]);

  const liveSymbols = useMemo(
    () => filtered.slice(0, 60).map((o) => o.symbol),
    [filtered],
  );
  const liveTicks = useBinanceLivePrices(
    open && !isForex ? liveSymbols : [],
  );

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1023px)");
    const sync = () => setMobile(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (!open || mobile) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (
        triggerRef.current?.contains(t) ||
        panelRef.current?.contains(t)
      ) {
        return;
      }
      setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open, mobile]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  function openPanel() {
    if (!open) onOpen?.();
    setOpen((o) => !o);
  }

  function pick(sym: string) {
    onChange(sym);
    setOpen(false);
  }

  const panelContent = (
    <div className="flex flex-col">
      <div className="relative border-b border-border/60 px-3 py-2">
        <Search className="absolute start-5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          className="h-9 w-full rounded-lg border border-border bg-secondary/50 ps-9 pe-3 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
          placeholder={
            isForex
              ? "ابحث عن زوج فوركس…"
              : openAssets
                ? "ابحث عن زوج USDT…"
                : "فلترة الأزواج…"
          }
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          dir="ltr"
          aria-label="بحث عن زوج"
          autoFocus={open}
        />
      </div>

      {loading && (
        <div className="flex items-center justify-center gap-2 py-4 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          جارٍ التحميل…
        </div>
      )}

      <div
        className={cn(
          "overflow-y-auto p-2",
          mobile ? "max-h-[50dvh]" : "max-h-[min(60dvh,24rem)]",
        )}
      >
        {filtered.length === 0 && !loading ? (
          <p className="py-6 text-center text-xs text-muted-foreground">
            لا توجد أزواج مطابقة
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-1.5 lg:grid-cols-6">
            {filtered.map((inst) => {
              const stat = liveTicks[inst.symbol];
              const up = stat?.price ? stat.changePct >= 0 : null;
              const active = value === inst.symbol;
              return (
                <button
                  key={inst.symbol}
                  type="button"
                  onMouseEnter={() =>
                    prefetchKlines(inst.symbol, interval, market, 120)
                  }
                  onClick={() => pick(inst.symbol)}
                  className={cn(
                    "rounded-lg border px-2 py-2 text-start transition",
                    active
                      ? "border-primary bg-primary/10"
                      : "border-border bg-card hover:border-foreground/20 hover:bg-secondary/50",
                  )}
                >
                  <div className="flex items-start justify-between gap-1">
                    <p className="text-xs font-semibold leading-tight" dir="ltr">
                      {inst.base}
                    </p>
                    {stat?.price ? (
                      <span
                        className={cn(
                          "inline-flex shrink-0 items-center gap-0.5 text-[9px] font-medium tabular-nums",
                          up ? "text-green-500" : "text-red-500",
                        )}
                        dir="ltr"
                      >
                        {up ? (
                          <TrendingUp className="h-2.5 w-2.5 shrink-0" />
                        ) : (
                          <TrendingDown className="h-2.5 w-2.5 shrink-0" />
                        )}
                        {stat.changePct >= 0 ? "+" : ""}
                        {stat.changePct.toFixed(1)}%
                      </span>
                    ) : null}
                  </div>
                  <p className="text-[9px] text-muted-foreground" dir="ltr">
                    {inst.quote}
                  </p>
                  {stat?.price ? (
                    <p
                      className="mt-0.5 text-[10px] font-medium tabular-nums text-foreground"
                      dir="ltr"
                    >
                      {formatTickerPrice(stat.price)}
                    </p>
                  ) : null}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );

  const desktopPanel =
    open &&
    !mobile &&
    typeof document !== "undefined" &&
    createPortal(
      <div className="pointer-events-auto fixed inset-0 z-[60] flex items-center justify-center p-4">
        <button
          type="button"
          className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
          aria-label="إغلاق"
          onClick={() => setOpen(false)}
        />
        <div
          ref={panelRef}
          className="relative z-10 flex w-full max-w-3xl flex-col rounded-2xl border border-border bg-card shadow-2xl"
          role="dialog"
          aria-modal
          aria-label="اختيار الزوج"
        >
          <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
            <span className="text-sm font-semibold">اختيار الزوج</span>
            <button
              type="button"
              className="rounded-lg p-1.5 text-muted-foreground hover:bg-secondary"
              aria-label="إغلاق"
              onClick={() => setOpen(false)}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          {panelContent}
        </div>
      </div>,
      document.body,
    );

  const mobilePanel =
    open &&
    mobile &&
    typeof document !== "undefined" &&
    createPortal(
      <>
        <button
          type="button"
          className="pointer-events-auto fixed inset-0 z-[60] bg-black/40 backdrop-blur-[2px]"
          aria-label="إغلاق"
          onClick={() => setOpen(false)}
        />
        <div
          ref={panelRef}
          className="pointer-events-auto fixed inset-x-0 bottom-0 z-[70] flex max-h-[70dvh] flex-col rounded-t-2xl border-t border-border bg-card shadow-xl"
        >
          <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
            <span className="text-sm font-semibold">اختيار الزوج</span>
            <button
              type="button"
              className="rounded-lg p-1.5 text-muted-foreground hover:bg-secondary"
              aria-label="إغلاق"
              onClick={() => setOpen(false)}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          {panelContent}
        </div>
      </>,
      document.body,
    );

  return (
    <div className="relative pointer-events-auto">
      <button
        ref={triggerRef}
        type="button"
        className={cn(CTRL, "max-w-[8rem] px-2")}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={openPanel}
        dir="ltr"
      >
        <span className="truncate">
          {isForex ? value : value.replace(/USDT$/, "")}
        </span>
        <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
      </button>
      {desktopPanel}
      {mobilePanel}
    </div>
  );
}
