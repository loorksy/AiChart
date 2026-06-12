"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { ConsoleActiveTradeRow } from "@/lib/consoleActiveTrades";
import { cn } from "@/lib/utils";
import { StatusChip } from "@/components/bridge/StatusChip";

function fmtNum(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function fmtPnl(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}`;
}

export function ActiveTradesTable({ className }: { className?: string }) {
  const [rows, setRows] = useState<ConsoleActiveTradeRow[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/console/trades-active", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { rows: ConsoleActiveTradeRow[] };
      setRows(Array.isArray(data.rows) ? data.rows : []);
    } catch {
      /* keep last */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 30_000);
    return () => clearInterval(t);
  }, [refresh]);

  if (rows.length === 0 && !loading) {
    return (
      <div
        className={cn(
          "rounded-xl border border-border bg-card p-6 text-center text-sm text-muted-foreground",
          className,
        )}
      >
        لا صفقات مفتوحة حالياً.
      </div>
    );
  }

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">الصفقات الفعّالة</h3>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading}
          className="text-xs text-link disabled:opacity-50"
        >
          {loading ? "جارٍ التحديث…" : "تحديث"}
        </button>
      </div>

      <div className="hidden overflow-x-auto rounded-xl border border-border md:block">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-border bg-secondary/50 text-xs text-muted-foreground">
              <th className="px-3 py-2 text-start font-medium">الرمز</th>
              <th className="px-3 py-2 text-start font-medium">المنصة</th>
              <th className="px-3 py-2 text-start font-medium">الاتجاه</th>
              <th className="px-3 py-2 text-start font-medium">الرافعة</th>
              <th className="px-3 py-2 text-start font-medium">الهامش</th>
              <th className="px-3 py-2 text-start font-medium">PnL</th>
              <th className="px-3 py-2 text-start font-medium">SL/TP</th>
              <th className="px-3 py-2 text-start font-medium">Env</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-border/60 last:border-0">
                <td className="px-3 py-2.5 font-medium" dir="ltr">
                  {r.symbol}
                  {r.status === "pending_entry" && (
                    <span className="ms-1 text-[10px] text-chart-1">limit</span>
                  )}
                </td>
                <td className="px-3 py-2.5">
                  <StatusChip
                    label={r.platform}
                    tone={
                      r.platform === "MT5"
                        ? "warn"
                        : r.platform === "Futures"
                          ? "ok"
                          : "neutral"
                    }
                  />
                </td>
                <td className="px-3 py-2.5">{r.side}</td>
                <td className="px-3 py-2.5" dir="ltr">
                  {r.leverage != null ? `${r.leverage}x` : "—"}
                </td>
                <td className="px-3 py-2.5" dir="ltr">
                  {fmtNum(r.margin)}
                </td>
                <td
                  className={cn(
                    "px-3 py-2.5 font-medium",
                    r.unrealizedPnl != null &&
                      (r.unrealizedPnl > 0
                        ? "text-chart-1"
                        : r.unrealizedPnl < 0
                          ? "text-destructive"
                          : ""),
                  )}
                  dir="ltr"
                >
                  {fmtPnl(r.unrealizedPnl)}
                </td>
                <td className="px-3 py-2.5 text-xs text-muted-foreground" dir="ltr">
                  {fmtNum(r.sl)} / {fmtNum(r.tp)}
                </td>
                <td className="px-3 py-2.5 text-xs">{r.env}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="space-y-2 md:hidden">
        {rows.map((r) => (
          <div
            key={r.id}
            className="rounded-xl border border-border bg-card p-3 text-sm"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold" dir="ltr">
                {r.symbol}
              </span>
              <StatusChip label={r.platform} tone="neutral" />
            </div>
            <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span>{r.side}</span>
              <span dir="ltr">PnL: {fmtPnl(r.unrealizedPnl)}</span>
              <span>رافعة: {r.leverage != null ? `${r.leverage}x` : "—"}</span>
              <span>
                SL/TP: {fmtNum(r.sl)}/{fmtNum(r.tp)}
              </span>
              <span>Env: {r.env}</span>
            </div>
          </div>
        ))}
      </div>

      <Link href="/console/trades" className="inline-block text-xs text-link">
        كل الصفقات ←
      </Link>
    </div>
  );
}
