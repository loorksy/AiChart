"use client";

import { useLocale } from "@/hooks/useLocale";
import type { RecommendationStats } from "@/lib/recommendations/recommendationStats";

function Tile({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="glass-card p-3 hover:border-primary/35">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className={`text-lg font-bold ${tone ?? "text-foreground"}`}>{value}</p>
    </div>
  );
}

/** Main statistics header: total / active / pending / wins / losses / win rate. */
export function RecommendationStatsOverview({ stats }: { stats: RecommendationStats }) {
  const { t } = useLocale();
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
      <Tile label={t("stats.total")} value={String(stats.total)} />
      <Tile label={t("stats.active")} value={String(stats.active)} tone="text-sky-500" />
      <Tile label={t("stats.pending")} value={String(stats.pending)} tone="text-amber-500" />
      <Tile label={t("stats.winning")} value={String(stats.wins)} tone="text-emerald-500" />
      <Tile label={t("stats.losing")} value={String(stats.losses)} tone="text-red-500" />
      <Tile label={t("stats.win_rate")} value={`${stats.winRate}%`} tone="text-emerald-500" />
      <Tile
        label={t("stats.completed")}
        value={String(stats.completedTriggered)}
      />
      {stats.avgPlannedRr != null && (
        <Tile label={t("stats.avg_planned_rr")} value={String(stats.avgPlannedRr)} />
      )}
    </div>
  );
}
