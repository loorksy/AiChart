"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowDownCircle,
  ArrowUpCircle,
  CandlestickChart,
  Clock3,
  History,
  Search,
} from "lucide-react";
import { formatLevel } from "@/components/market/formatLevel";
import type { Recommendation } from "@/lib/types";
import { cn } from "@/lib/utils";

function actionMeta(action: string) {
  if (action === "buy")
    return { label: "شراء", icon: ArrowUpCircle, cls: "text-emerald-400 border-emerald-500/30 bg-emerald-500/10" };
  if (action === "sell")
    return { label: "بيع", icon: ArrowDownCircle, cls: "text-red-400 border-red-500/30 bg-red-500/10" };
  return { label: "انتظار", icon: Clock3, cls: "text-amber-400 border-amber-500/30 bg-amber-500/10" };
}

function fmtDate(v?: string | null): string {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("ar-EG", { dateStyle: "medium", timeStyle: "short" });
}

/** سجل التوصيات — all past AI recommendations with levels + confidence. */
export default function RecommendationsHistoryClient({
  initial,
}: {
  initial: Recommendation[];
}) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "buy" | "sell" | "wait">("all");

  const rows = useMemo(() => {
    const query = q.trim().toUpperCase();
    return initial.filter((r) => {
      if (filter !== "all" && r.action !== filter) return false;
      if (query && !r.symbol?.toUpperCase().includes(query)) return false;
      return true;
    });
  }, [initial, q, filter]);

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6" dir="rtl">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <History className="h-6 w-6 text-primary" />
          <h1 className="text-xl font-bold text-foreground">سجل التوصيات</h1>
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            {rows.length}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute end-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="بحث بالزوج…"
              className="w-40 rounded-lg border border-border bg-card px-3 py-1.5 pe-8 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/25"
            />
          </div>
          <div className="flex overflow-hidden rounded-lg border border-border text-xs">
            {(
              [
                ["all", "الكل"],
                ["buy", "شراء"],
                ["sell", "بيع"],
                ["wait", "انتظار"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setFilter(key)}
                className={cn(
                  "px-3 py-1.5 transition",
                  filter === key
                    ? "bg-primary text-primary-foreground"
                    : "bg-card text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="glass-card border-dashed px-6 py-16 text-center">
          <History className="mx-auto mb-3 h-10 w-10 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">
            لا توصيات بعد — افتح الشارت واضغط «تحليل» لتبدأ.
          </p>
          <Link
            href="/chart"
            className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
          >
            <CandlestickChart className="h-4 w-4" />
            فتح الشارت
          </Link>
        </div>
      ) : (
        <div className="space-y-2.5">
          {rows.map((r) => {
            const meta = actionMeta(r.action);
            const Icon = meta.icon;
            const conf = Math.min(100, Math.max(0, r.confidence ?? 0));
            return (
              <div
                key={r.id}
                className="glass-card p-3.5 transition hover:border-primary/35"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <span
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold",
                        meta.cls,
                      )}
                    >
                      <Icon className="h-4 w-4" />
                      {meta.label}
                    </span>
                    <Link
                      href={`/chart/${encodeURIComponent(r.symbol)}`}
                      className="text-sm font-bold text-foreground hover:text-primary"
                      dir="ltr"
                    >
                      {r.symbol}
                    </Link>
                    {r.timeframe && (
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground" dir="ltr">
                        {r.timeframe}
                      </span>
                    )}
                    {r.pattern_name && (
                      <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">
                        {r.pattern_name}
                      </span>
                    )}
                  </div>
                  <span className="text-[11px] text-muted-foreground">
                    {fmtDate(r.created_at)}
                  </span>
                </div>

                {(r.action === "buy" || r.action === "sell") && (
                  <div className="mt-2.5 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs">
                    <span className="text-emerald-300">
                      دخول <b dir="ltr">{formatLevel(r.entry)}</b>
                    </span>
                    <span className="text-red-300">
                      وقف <b dir="ltr">{formatLevel(r.stop_loss)}</b>
                    </span>
                    <span className="text-blue-300">
                      هدف <b dir="ltr">{formatLevel(r.take_profit)}</b>
                    </span>
                    <span className="ms-auto flex items-center gap-1.5 text-muted-foreground">
                      الثقة
                      <span className="inline-block h-1.5 w-16 overflow-hidden rounded-full bg-muted">
                        <span
                          className={cn(
                            "block h-full rounded-full",
                            conf >= 75 ? "bg-emerald-500" : conf >= 55 ? "bg-amber-500" : "bg-red-500",
                          )}
                          style={{ width: `${conf}%` }}
                        />
                      </span>
                      <b dir="ltr">{conf}%</b>
                    </span>
                  </div>
                )}

                {r.rationale && (
                  <p className="mt-2 line-clamp-2 text-[12px] leading-5 text-muted-foreground">
                    {r.rationale}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
