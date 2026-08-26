"use client";

/**
 * Terminal grades as a bar list — the finer taxonomy (tradeMetrics.ts) the
 * plain outcome breakdown cannot express: partial wins, expired-in-profit vs
 * -in-loss, missed opportunities, superseded plans. Zero-count grades are
 * hidden; the point is the shape of the record, not an empty taxonomy.
 */
import { useLocale } from "@/hooks/useLocale";
import type { RecommendationStats } from "@/lib/recommendations/recommendationStats";
import type { RecommendationGrade } from "@/lib/recommendations/tradeMetrics";
import { cn } from "@/lib/utils";

const BAR_TONES: Partial<Record<RecommendationGrade, string>> = {
  win_tp3: "bg-buy",
  win_tp2: "bg-buy",
  win_tp1: "bg-buy",
  expired_in_profit: "bg-buy/60",
  loss: "bg-sell",
  expired_in_loss: "bg-sell/60",
  invalidated_in_trade: "bg-sell/50",
  missed_opportunity: "bg-warning",
};

export function GradeBreakdownTable({ stats }: { stats: RecommendationStats }) {
  const { t } = useLocale();
  const rows = stats.byGrade.filter((g) => g.count > 0);
  if (rows.length === 0) return null;
  const max = Math.max(...rows.map((g) => g.count));

  return (
    <div className="glass-card p-3" data-testid="grade-breakdown">
      <h3 className="mb-2 text-sm font-semibold text-foreground">
        {t("stats.by_grade")}
      </h3>
      <div className="space-y-1.5">
        {rows.map((g) => (
          <div key={g.grade} className="flex items-center gap-2">
            <span className="w-44 shrink-0 truncate text-xs text-muted-foreground">
              {t(`rec.grade.${g.grade}`)}
            </span>
            <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
              <div
                className={cn("h-full rounded-full", BAR_TONES[g.grade] ?? "bg-foreground/40")}
                style={{ width: `${Math.max(4, Math.round((g.count / max) * 100))}%` }}
              />
            </div>
            <span className="w-8 shrink-0 text-end font-mono text-xs font-bold tabular-nums text-foreground">
              {g.count}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
