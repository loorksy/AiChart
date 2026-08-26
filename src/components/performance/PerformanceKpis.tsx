"use client";

/**
 * The R-based KPI row of the performance dashboard: expectancy, profit
 * factor, average win/loss R, activation rate, net R, excursion means and
 * durations — every figure from computeRecommendationStats, quoted rates
 * suppressed below the sample floor with an honest note instead of a number.
 */
import { useLocale } from "@/hooks/useLocale";
import { formatDurationMs } from "@/lib/display/duration";
import {
  WIN_RATE_SAMPLE_FLOOR,
  type RecommendationStats,
} from "@/lib/recommendations/recommendationStats";
import { cn } from "@/lib/utils";

function fmtR(value: number | null): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}R`;
}

function Tile({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | null;
  tone?: string;
}) {
  return (
    <div
      data-testid="kpi-tile"
      className="flex min-h-[4.5rem] flex-col justify-between rounded-lg border border-border bg-card p-3"
    >
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p
        className={cn(
          "font-mono text-lg font-semibold tabular-nums tracking-tight",
          value == null ? "text-muted-foreground" : (tone ?? "text-foreground"),
        )}
        dir="ltr"
      >
        {value ?? "—"}
      </p>
    </div>
  );
}

export function PerformanceKpis({ stats }: { stats: RecommendationStats }) {
  const { t, locale } = useLocale();
  const dl = locale === "ar" ? "ar" : "en";

  const toneOf = (v: number | null) =>
    v == null ? undefined : v >= 0 ? "text-buy" : "text-sell";

  const suppressed =
    stats.winRate == null && stats.completedTriggered > 0 && stats.total > 0;

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <Tile
          label={t("stats.win_rate")}
          value={stats.winRate == null ? null : `${stats.winRate}%`}
          tone="text-buy"
        />
        <Tile
          label={t("stats.expectancy")}
          value={fmtR(stats.expectancyR)}
          tone={toneOf(stats.expectancyR)}
        />
        <Tile
          label={t("stats.profit_factor")}
          value={stats.profitFactor == null ? null : stats.profitFactor.toFixed(2)}
          tone={
            stats.profitFactor == null
              ? undefined
              : stats.profitFactor >= 1
                ? "text-buy"
                : "text-sell"
          }
        />
        <Tile label={t("stats.avg_win_r")} value={fmtR(stats.avgWinR)} tone="text-buy" />
        <Tile label={t("stats.avg_loss_r")} value={fmtR(stats.avgLossR)} tone="text-sell" />
        <Tile
          label={t("stats.activation_rate")}
          value={
            stats.activationRate == null
              ? null
              : `${Math.round(stats.activationRate * 100)}%`
          }
        />
        <Tile
          label={t("stats.total_r")}
          value={fmtR(stats.totalRealizedR)}
          tone={toneOf(stats.totalRealizedR)}
        />
        <Tile label={t("stats.avg_mfe")} value={fmtR(stats.avgMfeR)} tone="text-buy" />
        <Tile label={t("stats.avg_mae")} value={fmtR(stats.avgMaeR)} tone="text-sell" />
        <Tile
          label={t("stats.avg_time_to_activation")}
          value={formatDurationMs(stats.avgTimeToActivationMs, dl)}
        />
        <Tile
          label={t("stats.avg_time_in_trade")}
          value={formatDurationMs(stats.avgTimeInTradeMs, dl)}
        />
        <Tile
          label={t("stats.avg_planned_rr")}
          value={stats.avgPlannedRr == null ? null : stats.avgPlannedRr.toFixed(2)}
        />
      </div>
      {suppressed ? (
        <p className="text-[11px] text-muted-foreground">
          {t("stats.sample_floor_note", { n: String(WIN_RATE_SAMPLE_FLOOR) })}
        </p>
      ) : null}
    </div>
  );
}
