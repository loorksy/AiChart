"use client";

import { useState } from "react";
import PriceChart from "./PriceChart";
import type { Recommendation } from "@/lib/types";

const INTERVALS = ["15m", "1h", "4h", "1d", "1w"];

function RecFactors({ factors }: { factors: string | null }) {
  let list: string[] = [];
  try {
    list = factors ? (JSON.parse(factors) as string[]) : [];
  } catch {
    list = [];
  }
  if (!list.length) return null;
  return (
    <ul className="mt-2 space-y-0.5 border-t border-[var(--border)] pt-2">
      {list.map((f, i) => (
        <li key={i} className="text-xs text-[var(--muted)]">
          • {f}
        </li>
      ))}
    </ul>
  );
}

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

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">الشارت الحي</h1>
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="input w-auto py-1.5"
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
                onClick={() => setInterval(iv)}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                  interval === iv
                    ? "bg-[var(--accent)] text-[#04130c]"
                    : "bg-[var(--surface-2)] text-[var(--muted)] hover:text-[var(--foreground)]"
                }`}
              >
                {iv}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="card p-3">
        <PriceChart
          symbol={symbol}
          interval={interval}
          recommendations={recommendations}
        />
      </div>

      <p className="mt-3 text-xs text-[var(--muted)]">
        الأسهم الخضراء = توصيات شراء، الحمراء = توصيات بيع، على الرمز المعروض.
        البيانات من Binance.
      </p>

      {recommendations.filter((r) => r.symbol === symbol).length > 0 && (
        <div className="mt-6">
          <h2 className="mb-3 font-bold">توصيات {symbol}</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {recommendations
              .filter((r) => r.symbol === symbol)
              .slice(0, 6)
              .map((r) => (
                <div key={r.id} className="card p-4 text-sm">
                  <div className="mb-1 flex items-center justify-between">
                    <span
                      className="font-bold"
                      style={{
                        color:
                          r.action === "buy"
                            ? "var(--accent)"
                            : r.action === "sell"
                              ? "var(--danger)"
                              : "var(--warning)",
                      }}
                    >
                      {r.action === "buy"
                        ? "شراء"
                        : r.action === "sell"
                          ? "بيع"
                          : "انتظار"}{" "}
                      · {r.confidence}%
                    </span>
                    <span className="text-xs text-[var(--muted)]" dir="ltr">
                      {r.created_at.slice(0, 16)}
                    </span>
                  </div>
                  {r.rationale && (
                    <p className="text-xs text-[var(--muted)]">{r.rationale}</p>
                  )}
                  <RecFactors factors={r.factors} />
                </div>
              ))}
          </div>
        </div>
      )}
    </main>
  );
}
