"use client";

import { useEffect, useState } from "react";
import { useLocale } from "@/hooks/useLocale";
import { RecommendationStatsOverview } from "@/components/recommendations/RecommendationStatsOverview";
import { RecommendationOutcomeBreakdown } from "@/components/recommendations/RecommendationOutcomeBreakdown";
import { RecommendationPerformanceTable } from "@/components/recommendations/RecommendationPerformanceTable";
import type { RecommendationStats, StatsPeriod } from "@/lib/recommendations/recommendationStats";

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
    <div dir={dir} className="mx-auto max-w-5xl space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-bold text-foreground">{t("stats.title")}</h1>
        <div className="glass-card inline-flex p-0.5">
          {PERIODS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setPeriod(p.id)}
              className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                period === p.id
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t(p.labelKey)}
            </button>
          ))}
        </div>
      </div>

      {empty && (
        <p className="glass-card p-6 text-center text-sm text-muted-foreground">
          {t("stats.empty")}
        </p>
      )}

      {stats && !empty && (
        <>
          <RecommendationStatsOverview stats={stats} />
          <RecommendationOutcomeBreakdown stats={stats} />
          {stats.scalp.total > 0 && (
            <RecommendationPerformanceTable
              titleKey="stats.scalp"
              groups={[stats.scalp]}
              renderKey={() => t("stats.scalp")}
            />
          )}
          <div className="grid gap-4 md:grid-cols-2">
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
