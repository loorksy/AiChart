"use client";

import { useCallback, useEffect, useState } from "react";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import PriceChart from "./PriceChart";
import type { Recommendation } from "@/lib/types";

const INTERVALS = ["15m", "1h", "4h", "1d", "1w"];

interface Instrument {
  symbol: string;
  base: string;
  quote: string;
}

export default function MarketClient({
  openAssets,
  allowedAssets,
  recommendations,
}: {
  openAssets: boolean;
  allowedAssets: string[];
  recommendations: Recommendation[];
}) {
  const symbols = openAssets
    ? []
    : allowedAssets.length
      ? allowedAssets
      : ["BTCUSDT", "ETHUSDT"];

  const [symbol, setSymbol] = useState(
    openAssets ? "BTCUSDT" : symbols[0] ?? "BTCUSDT",
  );
  const [interval, setInterval] = useState("1h");
  const [search, setSearch] = useState("");
  const [instruments, setInstruments] = useState<Instrument[]>([]);
  const [loadingInstruments, setLoadingInstruments] = useState(false);

  const fetchInstruments = useCallback(async (q: string) => {
    setLoadingInstruments(true);
    try {
      const params = q ? `?q=${encodeURIComponent(q)}&wrapped=1` : "?wrapped=1";
      const res = await fetch(`/api/instruments${params}`);
      const data = await res.json();
      if (res.ok) {
        setInstruments(
          Array.isArray(data) ? data : (data.instruments ?? []),
        );
      }
    } catch {
      setInstruments([]);
    } finally {
      setLoadingInstruments(false);
    }
  }, []);

  useEffect(() => {
    if (!openAssets) return;
    const t = setTimeout(() => void fetchInstruments(search), 300);
    return () => clearTimeout(t);
  }, [openAssets, search, fetchInstruments]);

  const pickerOptions = openAssets
    ? instruments
    : symbols.map((s) => ({
        symbol: s,
        base: s.replace(/USDT$/, ""),
        quote: "USDT",
      }));

  const symbolRecs = recommendations.filter((r) => r.symbol === symbol);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 bg-card/80 px-4 py-3 backdrop-blur-md">
        <div>
          <h1 className="text-lg font-bold text-foreground">الشارت الحي</h1>
          {openAssets && (
            <p className="text-[11px] text-muted-foreground">
              جميع أزواج USDT من Binance — تحديث تلقائي
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {openAssets && (
            <div className="relative">
              <Search className="absolute start-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                className="input w-40 py-1.5 ps-9 text-sm"
                placeholder="ابحث…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                dir="ltr"
              />
            </div>
          )}
          <select
            className="input w-auto max-w-[200px] py-1.5 text-sm"
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            dir="ltr"
          >
            {pickerOptions.length === 0 && (
              <option value={symbol}>{symbol}</option>
            )}
            {pickerOptions.map((inst) => (
              <option key={inst.symbol} value={inst.symbol}>
                {inst.symbol}
              </option>
            ))}
          </select>
          {openAssets && loadingInstruments && (
            <span className="text-xs text-muted-foreground">…</span>
          )}
          <div className="flex gap-1">
            {INTERVALS.map((iv) => (
              <button
                key={iv}
                type="button"
                onClick={() => setInterval(iv)}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-xs font-medium",
                  interval === iv
                    ? "bg-primary text-primary-foreground"
                    : "bg-secondary text-muted-foreground hover:text-foreground",
                )}
              >
                {iv}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="relative min-h-0 flex-1 p-2 md:p-4">
        <div className="surface-card h-full min-h-[50dvh] overflow-hidden p-1">
          <PriceChart
            symbol={symbol}
            interval={interval}
            recommendations={recommendations}
            className="h-full min-h-[400px]"
          />
        </div>
      </div>

      {symbolRecs.length > 0 && (
        <div className="border-t border-border/60 bg-card/80 px-4 py-3 backdrop-blur-md">
          <p className="mb-2 text-xs font-medium text-muted-foreground">
            آخر توصيات {symbol}
          </p>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {symbolRecs.slice(0, 5).map((r) => (
              <div
                key={r.id}
                className="shrink-0 rounded-lg border border-border bg-secondary px-3 py-2 text-xs"
              >
                <span
                  className={cn(
                    "font-semibold",
                    r.action === "buy" ? "text-green-600" : "text-red-500",
                  )}
                >
                  {r.action === "buy" ? "شراء" : "بيع"} {r.confidence}%
                </span>
                {r.rationale && (
                  <p className="mt-1 max-w-[200px] truncate text-muted-foreground">
                    {r.rationale}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
