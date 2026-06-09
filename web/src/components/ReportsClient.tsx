"use client";

import { useMemo, useState } from "react";
import { Download, FileSpreadsheet, FileText, Trophy } from "lucide-react";
import type { Trade } from "@/lib/types";
import {
  buildSymbolPerformance,
  computeStats,
  filterByPeriod,
  formatCurrency,
  formatPct,
  PERIOD_OPTIONS,
  type PeriodKey,
} from "@/lib/analytics";
import { exportReportPdf, exportTradesCsv } from "@/lib/reportExport";
import { cn } from "@/lib/utils";
import { PageLayout, SurfaceCard } from "@/components/ui/shell";
import { KpiCard } from "@/components/dashboard/KpiCard";
import { PeriodSelector } from "@/components/charts/PeriodSelector";

export default function ReportsClient({
  trades,
  userEmail,
}: {
  trades: Trade[];
  userEmail: string;
}) {
  const [period, setPeriod] = useState<PeriodKey>("30d");

  const filtered = useMemo(() => filterByPeriod(trades, period), [trades, period]);
  const stats = useMemo(() => computeStats(filtered), [filtered]);
  const symbolPerf = useMemo(() => buildSymbolPerformance(filtered), [filtered]);
  const periodLabel =
    PERIOD_OPTIONS.find((p) => p.key === period)?.label ?? "الكل";

  const closedTrades = filtered.filter((t) => t.status !== "open");
  const best = symbolPerf.slice(0, 5);
  const worst = symbolPerf.slice(-5).reverse();

  return (
    <PageLayout
      title="التقارير"
      subtitle="ملخص الأداء وتصدير البيانات"
      actions={
        <>
          <button
            type="button"
            onClick={() => exportTradesCsv(filtered, `aichart-${period}.csv`)}
            disabled={filtered.length === 0}
            className="btn btn-secondary py-2 text-sm disabled:opacity-50"
          >
            <FileSpreadsheet className="h-4 w-4" />
            CSV
          </button>
          <button
            type="button"
            onClick={() =>
              exportReportPdf({ stats, trades: filtered, periodLabel, userEmail })
            }
            disabled={filtered.length === 0}
            className="btn btn-primary py-2 text-sm disabled:opacity-50"
          >
            <Download className="h-4 w-4" />
            تصدير PDF
          </button>
        </>
      }
    >

      <PeriodSelector value={period} onChange={setPeriod} className="w-full sm:w-auto" />

      {filtered.length === 0 ? (
        <SurfaceCard className="flex flex-col items-center gap-3 py-12 text-center">
          <FileText className="h-10 w-10 text-muted-foreground" />
          <div>
            <p className="font-medium">لا توجد بيانات في هذه الفترة</p>
            <p className="text-sm text-muted-foreground">
              جرّب فترة أطول أو ابدأ التداول لرؤية تقاريرك هنا.
            </p>
          </div>
        </SurfaceCard>
      ) : (
        <>
          {/* Summary KPIs */}
          <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
            <KpiCard
              label="إجمالي العائد"
              value={`${formatCurrency(stats.totalPnl)}`}
              sub="USDT محقّق"
              tone={stats.totalPnl >= 0 ? "positive" : "negative"}
            />
            <KpiCard
              label="نسبة الفوز"
              value={`${stats.winRate.toFixed(0)}%`}
              sub={`${stats.winningTrades}/${stats.closedTrades}`}
              tone="gold"
            />
            <KpiCard
              label="عامل الربح"
              value={isFinite(stats.profitFactor) ? stats.profitFactor.toFixed(2) : "∞"}
              tone={stats.profitFactor >= 1 ? "positive" : "negative"}
            />
            <KpiCard
              label="أقصى تراجع"
              value={formatCurrency(stats.maxDrawdown)}
              sub={formatPct(-stats.maxDrawdownPct)}
              tone="negative"
            />
          </div>

          {/* Best / Worst symbols */}
          <div className="grid gap-4 md:grid-cols-2">
            <SymbolList title="أفضل الأصول" icon items={best} />
            <SymbolList title="أضعف الأصول" items={worst} />
          </div>

          {/* Detailed trades table */}
          <SurfaceCard padding="none" className="overflow-hidden">
            <div className="flex items-center justify-between border-b border-border p-4">
              <h2 className="font-semibold">سجل الصفقات التفصيلي</h2>
              <span className="text-sm text-muted-foreground">
                {closedTrades.length} مغلقة · {stats.openTrades} مفتوحة
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-right text-sm">
                <thead className="border-b border-border text-muted-foreground">
                  <tr>
                    <th className="p-3">الرمز</th>
                    <th className="p-3">الاتجاه</th>
                    <th className="p-3">الكمية</th>
                    <th className="p-3">السعر</th>
                    <th className="p-3">PnL</th>
                    <th className="p-3">الحالة</th>
                    <th className="p-3">الوقت</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((t) => (
                    <tr key={t.id} className="border-b border-border/50">
                      <td className="p-3" dir="ltr">{t.symbol}</td>
                      <td className="p-3">{t.side === "buy" ? "شراء" : "بيع"}</td>
                      <td className="p-3 font-mono" dir="ltr">{t.qty}</td>
                      <td className="p-3 font-mono" dir="ltr">{t.avg_price}</td>
                      <td
                        className={cn(
                          "p-3 font-mono",
                          t.pnl >= 0 ? "text-chart-1" : "text-destructive",
                        )}
                        dir="ltr"
                      >
                        {t.pnl >= 0 ? "+" : ""}
                        {t.pnl.toFixed(2)}
                      </td>
                      <td className="p-3">
                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5 text-xs",
                            t.status === "open"
                              ? "bg-chart-1/15 text-chart-1"
                              : "bg-secondary text-muted-foreground",
                          )}
                        >
                          {t.status === "open" ? "مفتوحة" : "مغلقة"}
                        </span>
                      </td>
                      <td className="p-3 text-xs text-muted-foreground" dir="ltr">
                        {(t.closed_at ?? t.created_at).slice(0, 16)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SurfaceCard>
        </>
      )}
    </PageLayout>
  );
}

function SymbolList({
  title,
  items,
  icon = false,
}: {
  title: string;
  items: { symbol: string; pnl: number; trades: number; winRate: number }[];
  icon?: boolean;
}) {
  return (
    <SurfaceCard className="space-y-3">
      <div className="flex items-center gap-2">
        {icon && <Trophy className="h-4 w-4 text-accent-gold" />}
        <h2 className="font-semibold">{title}</h2>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">لا توجد بيانات.</p>
      ) : (
        <ul className="space-y-2">
          {items.map((s) => (
            <li
              key={s.symbol}
              className="flex items-center justify-between rounded-lg bg-secondary/40 px-3 py-2"
            >
              <span className="font-medium" dir="ltr">
                {s.symbol}
              </span>
              <span className="flex items-center gap-3 text-xs">
                <span className="text-muted-foreground">{s.trades} صفقة</span>
                <span className="text-muted-foreground">{s.winRate.toFixed(0)}%</span>
                <span
                  className={cn(
                    "w-16 text-end font-mono",
                    s.pnl >= 0 ? "text-chart-1" : "text-destructive",
                  )}
                  dir="ltr"
                >
                  {s.pnl >= 0 ? "+" : ""}
                  {formatCurrency(s.pnl)}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </SurfaceCard>
  );
}
