"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import PriceChart from "./PriceChart";
import type { Recommendation } from "@/lib/types";

const INTERVALS = ["15m", "1h", "4h", "1d", "1w"];

export default function MarketClient({
  allowedAssets,
  recommendations,
}: {
  allowedAssets: string[];
  recommendations: Recommendation[];
}) {
  const symbols = allowedAssets.length ? allowedAssets : ["BTCUSDT", "ETHUSDT"];
  const [symbol, setSymbol] = useState(symbols[0]);
  const [interval, setInterval] = useState("1h");

  const symbolRecs = recommendations.filter((r) => r.symbol === symbol);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Floating toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 bg-card/80 px-4 py-3 backdrop-blur-md">
        <h1 className="text-lg font-bold text-foreground">الشارت الحي</h1>
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="input w-auto py-1.5 text-sm"
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            dir="ltr"
          >
            {symbols.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
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

      {/* Full-height chart */}
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
