"use client";

import { useLocale } from "@/hooks/useLocale";
import type { RecommendationStats } from "@/lib/recommendations/recommendationStats";
import { cn } from "@/lib/utils";

function Tile({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div
      data-testid="stats-summary-card"
      className="flex min-h-[5.5rem] flex-col justify-between rounded-lg border border-border bg-card p-4"
    >
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("text-2xl font-semibold tracking-tight", tone ?? "text-foreground")}>
        {value}
      </p>
    </div>
  );
}

/** Responsive statistics summary grid for desktop dashboard layouts. */
export function RecommendationStatsOverview({ stats }: { stats: RecommendationStats }) {
  const { t } = useLocale();
  return (
    <div
      data-testid="stats-summary-grid"
      className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4"
    >
      <Tile label={t("stats.total")} value={String(stats.total)} />
      <Tile label={t("stats.active")} value={String(stats.active)} tone="text-[var(--info)]" />
      <Tile label={t("stats.pending")} value={String(stats.pending)} tone="text-[var(--warning)]" />
      <Tile label={t("stats.winning")} value={String(stats.wins)} tone="text-[var(--buy)]" />
      <Tile label={t("stats.losing")} value={String(stats.losses)} tone="text-[var(--sell)]" />
      <Tile label={t("stats.win_rate")} value={`${stats.winRate}%`} tone="text-[var(--buy)]" />
      <Tile label={t("stats.completed")} value={String(stats.completedTriggered)} />
      {stats.avgPlannedRr != null && (
        <Tile label={t("stats.avg_planned_rr")} value={String(stats.avgPlannedRr)} />
      )}
    </div>
  );
}
