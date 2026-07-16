"use client";

import { useLocale } from "@/hooks/useLocale";
import type { GroupStat } from "@/lib/recommendations/recommendationStats";

/** A localized win-rate table for a grouping (symbol / timeframe / setup …). */
export function RecommendationPerformanceTable({
  titleKey,
  groups,
  renderKey,
}: {
  titleKey: string;
  groups: GroupStat[];
  renderKey?: (key: string) => string;
}) {
  const { t } = useLocale();
  if (groups.length === 0) return null;
  return (
    <div className="glass-card p-3">
      <h3 className="mb-2 text-sm font-semibold text-foreground">{t(titleKey)}</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-muted-foreground">
              <th className="py-1 text-start font-medium">{t("stats.group")}</th>
              <th className="py-1 text-center font-medium">{t("stats.total")}</th>
              <th className="py-1 text-center font-medium">{t("stats.winning")}</th>
              <th className="py-1 text-center font-medium">{t("stats.losing")}</th>
              <th className="py-1 text-center font-medium">{t("stats.rate")}</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <tr key={g.key} className="border-t border-border/40">
                <td className="py-1 text-start font-medium text-foreground">
                  {renderKey ? renderKey(g.key) : g.key}
                </td>
                <td className="py-1 text-center text-muted-foreground">{g.total}</td>
                <td className="py-1 text-center text-emerald-500">{g.wins}</td>
                <td className="py-1 text-center text-red-500">{g.losses}</td>
                <td className="py-1 text-center font-semibold text-foreground">
                  {g.winRate}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
