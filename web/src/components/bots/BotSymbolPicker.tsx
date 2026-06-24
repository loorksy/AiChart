"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Loader2,
  Search,
  TrendingDown,
  TrendingUp,
  X,
} from "lucide-react";
import { formatTickerPrice } from "@/components/market/formatLevel";
import { useBinanceLivePrices } from "@/hooks/useBinanceLivePrice";
import type { BotBrokerSymbol } from "@/lib/botsMetaTypes";
import { cn } from "@/lib/utils";

type BotMarket = "forex" | "crypto";

function prettyLabel(row: BotBrokerSymbol, market: BotMarket): string {
  if (market === "crypto") {
    return row.base ?? row.symbol.replace(/USDT$/, "");
  }
  if (row.base && row.quote) return `${row.base}/${row.quote}`;
  const sym = row.symbol.replace(/[^A-Za-z0-9]/g, "");
  return sym.length >= 6 ? `${sym.slice(0, 3)}/${sym.slice(3, 6)}` : row.symbol;
}

function prettySub(row: BotBrokerSymbol, market: BotMarket): string {
  if (market === "crypto") return row.quote ?? "USDT";
  return row.symbol;
}

export function BotSymbolPicker({
  market,
  value,
  onChange,
  connected,
  onSymbolsLoaded,
}: {
  market: BotMarket;
  value: string;
  onChange: (symbol: string) => void;
  connected?: boolean;
  onSymbolsLoaded?: (symbols: BotBrokerSymbol[]) => void;
}) {
  const [search, setSearch] = useState("");
  const [symbols, setSymbols] = useState<BotBrokerSymbol[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  const fetchSymbols = useCallback(
    async (q: string) => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ market });
        if (q.trim()) params.set("q", q.trim());
        params.set("limit", "120");
        const r = await fetch(`/api/bots/symbols?${params}`, {
          cache: "no-store",
        });
        if (!r.ok) {
          setSymbols([]);
          setTotal(0);
          return;
        }
        const d = (await r.json()) as {
          symbols?: BotBrokerSymbol[];
          total?: number;
        };
        setSymbols(d.symbols ?? []);
        setTotal(d.total ?? d.symbols?.length ?? 0);
      } catch {
        setSymbols([]);
        setTotal(0);
      } finally {
        setLoading(false);
      }
    },
    [market],
  );

  useEffect(() => {
    const t = window.setTimeout(() => void fetchSymbols(search), 250);
    return () => window.clearTimeout(t);
  }, [search, fetchSymbols]);

  useEffect(() => {
    if (symbols.length > 0) onSymbolsLoaded?.(symbols);
  }, [symbols, onSymbolsLoaded]);

  const liveSymbols = useMemo(
    () =>
      market === "crypto"
        ? symbols.slice(0, 40).map((s) => s.symbol)
        : [],
    [market, symbols],
  );
  const liveTicks = useBinanceLivePrices(liveSymbols);

  const selected = value.trim().toUpperCase();

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          className="input w-full ps-9 pe-9 text-sm"
          placeholder={
            market === "forex"
              ? "ابحث (EURUSD…)"
              : "ابحث (BTC…)"
          }
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          dir="ltr"
          aria-label="بحث عن زوج"
        />
        {search && (
          <button
            type="button"
            className="absolute end-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-muted"
            onClick={() => setSearch("")}
            aria-label="مسح البحث"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <p className="text-[10px] text-muted-foreground">
        {loading
          ? "جارٍ تحميل الأزواج…"
          : total > 0
            ? `${total} زوج${total !== 1 ? "" : ""} · اختر من الشبكة`
            : connected === false
              ? "اربط حسابك لعرض الأزواج"
              : "لا توجد رموز — اربط حسابك أولاً"}
      </p>

      {loading && symbols.length === 0 ? (
        <div className="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          جارٍ التحميل…
        </div>
      ) : symbols.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border py-8 text-center text-xs text-muted-foreground">
          لا توجد أزواج مطابقة
        </p>
      ) : (
        <div className="grid max-h-[min(50dvh,20rem)] grid-cols-2 gap-2 overflow-y-auto pe-0.5">
          {symbols.map((row) => {
            const symKey = row.symbol.toUpperCase();
            const active = symKey === selected;
            const live =
              market === "crypto" ? liveTicks[row.symbol] : undefined;
            const price = live?.price || row.price || null;
            const changePct =
              live?.changePct ?? row.changePct ?? null;
            const up = changePct != null ? changePct >= 0 : null;

            return (
              <button
                key={row.symbol}
                type="button"
                onClick={() => onChange(row.symbol)}
                className={cn(
                  "rounded-xl border px-3 py-2.5 text-start transition",
                  active
                    ? "border-primary bg-primary/10"
                    : "border-border bg-card hover:border-foreground/20 hover:bg-secondary/50",
                  row.tradable === false && "opacity-60",
                )}
              >
                <div className="flex items-start justify-between gap-1">
                  <p className="text-xs font-semibold leading-tight" dir="ltr">
                    {prettyLabel(row, market)}
                  </p>
                  {changePct != null ? (
                    <span
                      className={cn(
                        "inline-flex shrink-0 items-center gap-0.5 text-[9px] font-medium tabular-nums",
                        up ? "text-emerald-500" : "text-rose-500",
                      )}
                      dir="ltr"
                    >
                      {up ? (
                        <TrendingUp className="h-2.5 w-2.5 shrink-0" />
                      ) : (
                        <TrendingDown className="h-2.5 w-2.5 shrink-0" />
                      )}
                      {changePct >= 0 ? "+" : ""}
                      {changePct.toFixed(1)}%
                    </span>
                  ) : null}
                </div>
                <p className="text-[9px] text-muted-foreground" dir="ltr">
                  {prettySub(row, market)}
                </p>
                <div className="mt-1 flex items-center justify-between gap-1">
                  {price ? (
                    <p
                      className="text-[10px] font-medium tabular-nums text-foreground"
                      dir="ltr"
                    >
                      {formatTickerPrice(price)}
                    </p>
                  ) : (
                    <span className="text-[10px] text-muted-foreground">—</span>
                  )}
                  {row.tickLabel ? (
                    <span className="text-[9px] text-muted-foreground" dir="ltr">
                      {row.tickLabel}
                    </span>
                  ) : null}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
