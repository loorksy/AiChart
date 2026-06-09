"use client";

import { useMemo, useState } from "react";
import {
  Activity,
  BarChart3,
  Gauge,
  Percent,
  TrendingDown,
  TrendingUp,
  Wallet,
} from "lucide-react";
import type { Trade } from "@/lib/types";
import {
  buildAssetDistribution,
  buildEquityCurve,
  computeStats,
  filterByPeriod,
  formatCurrency,
  formatPct,
  type PeriodKey,
} from "@/lib/analytics";
import { SurfaceCard } from "@/components/ui/shell";
import { KpiCard } from "@/components/dashboard/KpiCard";
import { PeriodSelector } from "@/components/charts/PeriodSelector";
import { InteractivePerformanceChart } from "@/components/charts/InteractivePerformanceChart";
import { AssetDistributionChart } from "@/components/charts/AssetDistributionChart";

/**
 * Presentation-only analytics section. Derives all metrics from the
 * provided trades; performs no trading logic and mutates nothing.
 */
export function DashboardAnalytics({ trades }: { trades: Trade[] }) {
  const [period, setPeriod] = useState<PeriodKey>("30d");

  const filtered = useMemo(() => filterByPeriod(trades, period), [trades, period]);
  const stats = useMemo(() => computeStats(filtered), [filtered]);
  const equity = useMemo(() => buildEquityCurve(filtered), [filtered]);
  const distribution = useMemo(() => buildAssetDistribution(filtered), [filtered]);

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-serif text-xl font-bold">الأداء</h2>
          <p className="text-sm text-muted-foreground">
            ملخص مبني على صفقاتك المسجّلة
          </p>
        </div>
        <PeriodSelector value={period} onChange={setPeriod} />
      </div>

      <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
        <KpiCard
          label="إجمالي العائد"
          value={`${formatCurrency(stats.totalPnl)}`}
          sub="USDT (محقّق)"
          icon={stats.totalPnl >= 0 ? TrendingUp : TrendingDown}
          tone={stats.totalPnl >= 0 ? "positive" : "negative"}
        />
        <KpiCard
          label="نسبة الفوز"
          value={`${stats.winRate.toFixed(0)}%`}
          sub={`${stats.winningTrades}/${stats.closedTrades} صفقة`}
          icon={Percent}
          tone="gold"
        />
        <KpiCard
          label="عامل الربح"
          value={isFinite(stats.profitFactor) ? stats.profitFactor.toFixed(2) : "∞"}
          sub="ربح ÷ خسارة"
          icon={Gauge}
          tone={stats.profitFactor >= 1 ? "positive" : "negative"}
        />
        <KpiCard
          label="أقصى تراجع"
          value={formatCurrency(stats.maxDrawdown)}
          sub={formatPct(-stats.maxDrawdownPct)}
          icon={Activity}
          tone="negative"
        />
        <KpiCard
          label="نسبة شارب"
          value={stats.sharpeRatio.toFixed(2)}
          sub="معدّل العائد/المخاطرة"
          icon={BarChart3}
          tone={stats.sharpeRatio >= 0 ? "positive" : "negative"}
        />
        <KpiCard
          label="متوسط الصفقة"
          value={formatCurrency(stats.avgPnl)}
          sub="USDT لكل صفقة"
          icon={Wallet}
          tone={stats.avgPnl >= 0 ? "positive" : "negative"}
        />
        <KpiCard
          label="أفضل صفقة"
          value={formatCurrency(stats.bestTrade)}
          sub="USDT"
          icon={TrendingUp}
          tone="positive"
        />
        <KpiCard
          label="صفقات مفتوحة"
          value={String(stats.openTrades)}
          sub={`${stats.totalTrades} إجمالاً`}
          icon={Activity}
          tone="neutral"
        />
      </div>

      <SurfaceCard className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">منحنى العائد التراكمي</h3>
          <span
            className={
              stats.cumulativePnl >= 0
                ? "font-mono text-sm text-chart-1"
                : "font-mono text-sm text-destructive"
            }
            dir="ltr"
          >
            {formatCurrency(stats.cumulativePnl)} USDT
          </span>
        </div>
        <InteractivePerformanceChart data={equity} />
      </SurfaceCard>

      <SurfaceCard className="space-y-3">
        <h3 className="font-semibold">توزيع رأس المال على الأصول</h3>
        <AssetDistributionChart data={distribution} />
      </SurfaceCard>
    </section>
  );
}
