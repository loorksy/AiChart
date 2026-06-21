"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { RefreshCw, TrendingUp, TrendingDown } from "lucide-react";
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

  /* ─── Empty state ─── */
  if (rows.length === 0 && !loading) {
    return (
      <div
        className={cn(
          "bento-card flex flex-col items-center gap-2 p-8 text-center",
          className,
        )}
      >
        <span className="text-zinc-600 text-sm">لا صفقات مفتوحة حالياً.</span>
        <Link href="/console/trades" className="text-xs text-green-500 hover:underline">
          عرض سجل الصفقات
        </Link>
      </div>
    );
  }

  return (
    <div className={cn("space-y-3", className)}>
      {/* Header row */}
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading}
          className="ms-auto flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs text-zinc-600 hover:bg-white/[0.04] hover:text-zinc-300 transition-all disabled:opacity-40 cursor-pointer"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          {loading ? "جارٍ التحديث…" : "تحديث"}
        </button>
      </div>

      {/* ─── Desktop table ─── */}
      <div className="hidden overflow-x-auto rounded-xl border border-white/[0.06] bg-[#0d0d10]/60 backdrop-blur-sm md:block">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-white/[0.05] text-[10px] font-semibold uppercase tracking-widest text-zinc-600">
              <th className="px-5 py-3 text-start">الرمز</th>
              <th className="px-5 py-3 text-start">المنصة</th>
              <th className="px-5 py-3 text-start">الاتجاه</th>
              <th className="px-5 py-3 text-start">الرافعة</th>
              <th className="px-5 py-3 text-start">الهامش</th>
              <th className="px-5 py-3 text-start">PnL</th>
              <th className="px-5 py-3 text-start">SL / TP</th>
              <th className="px-5 py-3 text-start">Env</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.04]">
            {rows.map((r) => {
              const pnlPositive = r.unrealizedPnl != null && r.unrealizedPnl > 0;
              const pnlNegative = r.unrealizedPnl != null && r.unrealizedPnl < 0;
              return (
                <tr
                  key={r.id}
                  className="transition-colors hover:bg-white/[0.025]"
                >
                  <td className="px-5 py-3.5 font-semibold text-zinc-100" dir="ltr">
                    {r.symbol}
                    {r.status === "pending_entry" && (
                      <span className="ms-2 rounded-full bg-green-500/10 px-1.5 py-0.5 text-[9px] font-bold uppercase text-green-400">
                        limit
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-3.5">
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
                  <td className="px-5 py-3.5">
                    <span className="flex items-center gap-1.5">
                      {r.side === "BUY" || r.side === "شراء" ? (
                        <TrendingUp className="h-3.5 w-3.5 text-green-400" />
                      ) : (
                        <TrendingDown className="h-3.5 w-3.5 text-red-400" />
                      )}
                      <span className={cn(
                        "font-medium text-xs",
                        r.side === "BUY" || r.side === "شراء"
                          ? "text-green-400"
                          : "text-red-400",
                      )}>
                        {r.side}
                      </span>
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-zinc-400" dir="ltr">
                    {r.leverage != null ? `${r.leverage}×` : "—"}
                  </td>
                  <td className="px-5 py-3.5 text-zinc-400" dir="ltr">
                    {fmtNum(r.margin)}
                  </td>
                  <td
                    className={cn(
                      "px-5 py-3.5 font-semibold",
                      pnlPositive
                        ? "text-green-400"
                        : pnlNegative
                          ? "text-red-400"
                          : "text-zinc-500",
                    )}
                    dir="ltr"
                  >
                    {fmtPnl(r.unrealizedPnl)}
                  </td>
                  <td className="px-5 py-3.5 text-xs text-zinc-600 font-mono" dir="ltr">
                    {fmtNum(r.sl)} / {fmtNum(r.tp)}
                  </td>
                  <td className="px-5 py-3.5 text-xs font-mono text-zinc-600">
                    {r.env}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ─── Mobile cards ─── */}
      <div className="space-y-2 md:hidden">
        {rows.map((r) => {
          const pnlPositive = r.unrealizedPnl != null && r.unrealizedPnl > 0;
          const pnlNegative = r.unrealizedPnl != null && r.unrealizedPnl < 0;
          return (
            <div
              key={r.id}
              className="bento-card p-4 text-sm"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-zinc-100" dir="ltr">
                  {r.symbol}
                </span>
                <StatusChip label={r.platform} tone="neutral" />
              </div>
              <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs text-zinc-500">
                <span>{r.side}</span>
                <span
                  className={cn(
                    "font-semibold",
                    pnlPositive
                      ? "text-green-400"
                      : pnlNegative
                        ? "text-red-400"
                        : "",
                  )}
                  dir="ltr"
                >
                  PnL: {fmtPnl(r.unrealizedPnl)}
                </span>
                <span>رافعة: {r.leverage != null ? `${r.leverage}×` : "—"}</span>
                <span dir="ltr">SL/TP: {fmtNum(r.sl)}/{fmtNum(r.tp)}</span>
                <span className="font-mono">Env: {r.env}</span>
              </div>
            </div>
          );
        })}
      </div>

      <Link
        href="/console/trades"
        className="inline-flex items-center gap-1 text-xs text-green-500 hover:text-green-400 transition-colors"
      >
        كل الصفقات ←
      </Link>
    </div>
  );
}
