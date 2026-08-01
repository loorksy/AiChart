"use client";

import { useLocale } from "@/hooks/useLocale";
import type { RecommendationStats } from "@/lib/recommendations/recommendationStats";

/** Outcome distribution: TP1/TP2/TP3, SL, expired, cancelled, invalidated. */
export function RecommendationOutcomeBreakdown({
  stats,
}: {
  stats: RecommendationStats;
}) {
  const { t } = useLocale();
  const b = stats.breakdown;
  const rows: { labelKey: string; value: number; tone: string }[] = [
    { labelKey: "stats.tp1_only", value: b.win_tp1, tone: "text-buy" },
    { labelKey: "stats.tp2_reached", value: b.win_tp2, tone: "text-buy" },
    { labelKey: "stats.tp3_reached", value: b.win_tp3, tone: "text-buy" },
    { labelKey: "stats.sl_hit", value: b.loss, tone: "text-sell" },
    { labelKey: "stats.expired", value: b.expired, tone: "text-muted-foreground" },
    { labelKey: "stats.cancelled", value: b.cancelled, tone: "text-muted-foreground" },
    { labelKey: "stats.invalidated", value: b.invalidated, tone: "text-muted-foreground" },
  ];
  return (
    <div className="glass-card p-3">
      <h3 className="mb-2 text-sm font-semibold text-foreground">
        {t("stats.breakdown")}
      </h3>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3">
        {rows.map((r) => (
          <div key={r.labelKey} className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">{t(r.labelKey)}</span>
            <span className={`text-sm font-bold ${r.tone}`}>{r.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
