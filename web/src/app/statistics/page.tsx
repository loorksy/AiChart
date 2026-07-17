"use client";

import { useEffect, useState } from "react";
import { useLocale } from "@/hooks/useLocale";
import { RecommendationStatsOverview } from "@/components/recommendations/RecommendationStatsOverview";
import { RecommendationOutcomeBreakdown } from "@/components/recommendations/RecommendationOutcomeBreakdown";
import { RecommendationPerformanceTable } from "@/components/recommendations/RecommendationPerformanceTable";
import type { RecommendationStats, StatsPeriod } from "@/lib/recommendations/recommendationStats";
import { cn } from "@/lib/utils";

const PERIODS: { id: StatsPeriod; labelKey: string }[] = [
  { id: "today", labelKey: "stats.filter.today" },
  { id: "7d", labelKey: "stats.filter.7d" },
  { id: "30d", labelKey: "stats.filter.30d" },
  { id: "all", labelKey: "stats.filter.all" },
];

export default function StatisticsPage() {
  const { t, dir } = useLocale();
  const [period, setPeriod] = useState<StatsPeriod>("all");
  const [stats, setStats] = useState<RecommendationStats | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const res = await fetch(`/api/recommendations/tracked/stats?period=${period}`, {
        cache: "no-store",
      });
      const json = res.ok ? ((await res.json()) as { stats?: RecommendationStats }) : null;
      if (alive) setStats(json?.stats ?? null);
    })();
    return () => {
      alive = false;
    };
  }, [period]);

  const empty = stats && stats.total === 0;

  return (
    <div dir={dir} className="mx-auto w-full max-w-7xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-foreground">{t("stats.title")}</h1>
        <div
          data-testid="stats-period-filters"
          className="inline-flex flex-wrap gap-1 rounded-lg border border-border bg-card p-1"
        >
          {PERIODS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setPeriod(p.id)}
              className={cn(
                "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                period === p.id
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t(p.labelKey)}
            </button>
          ))}
        </div>
      </div>

      {empty && (
        <p className="rounded-lg border border-border bg-card p-8 text-center text-sm text-muted-foreground">
          {t("stats.empty")}
        </p>
      )}

      {stats && !empty && (
        <>
          <RecommendationStatsOverview stats={stats} />
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="min-w-0 lg:col-span-2">
              <RecommendationOutcomeBreakdown stats={stats} />
            </div>
            {stats.scalp.total > 0 && (
              <div className="min-w-0 lg:col-span-2">
                <RecommendationPerformanceTable
                  titleKey="stats.scalp"
                  groups={[stats.scalp]}
                  renderKey={() => t("stats.scalp")}
                />
              </div>
            )}
            <RecommendationPerformanceTable titleKey="stats.by_symbol" groups={stats.bySymbol} />
            <RecommendationPerformanceTable titleKey="stats.by_timeframe" groups={stats.byTimeframe} />
            <RecommendationPerformanceTable titleKey="stats.by_setup" groups={stats.bySetupType} />
            <RecommendationPerformanceTable
              titleKey="stats.by_direction"
              groups={stats.byDirection}
              renderKey={(k) => (k === "buy" ? t("decision.buy") : t("decision.sell"))}
            />
          </div>
        </>
      )}
    </div>
  );
}
