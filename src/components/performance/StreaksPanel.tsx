"use client";

/**
 * Win/loss streaks: the run the record is on now, and the longest of each
 * kind. Expiries and invalidations neither extend nor break a streak (the
 * stats module's rule), so the panel reports exactly what the ledger proves.
 */
import { Flame, TrendingDown, TrendingUp } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import type { StreakSummary } from "@/lib/recommendations/recommendationStats";
import { cn } from "@/lib/utils";

export function StreaksPanel({ streaks }: { streaks: StreakSummary }) {
  const { t } = useLocale();
  const current = streaks.current;

  return (
    <div className="glass-card p-3" data-testid="streaks-panel">
      <h3 className="mb-2 text-sm font-semibold text-foreground">{t("stats.streaks")}</h3>
      <div className="grid grid-cols-3 gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <Flame className="h-3 w-3 shrink-0" aria-hidden />
            {t("stats.streak_current")}
          </p>
          <p
            className={cn(
              "mt-0.5 text-sm font-bold",
              current.kind === "win"
                ? "text-buy"
                : current.kind === "loss"
                  ? "text-sell"
                  : "text-muted-foreground",
            )}
          >
            {current.kind === "none"
              ? t("stats.streak_none")
              : `${current.length} ${t(
                  current.kind === "win" ? "stats.streak_win_label" : "stats.streak_loss_label",
                )}`}
          </p>
        </div>
        <div className="min-w-0">
          <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <TrendingUp className="h-3 w-3 shrink-0" aria-hidden />
            {t("stats.streak_wins")}
          </p>
          <p className="mt-0.5 font-mono text-sm font-bold tabular-nums text-buy" dir="ltr">
            {streaks.longestWins}
          </p>
        </div>
        <div className="min-w-0">
          <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <TrendingDown className="h-3 w-3 shrink-0" aria-hidden />
            {t("stats.streak_losses")}
          </p>
          <p className="mt-0.5 font-mono text-sm font-bold tabular-nums text-sell" dir="ltr">
            {streaks.longestLosses}
          </p>
        </div>
      </div>
    </div>
  );
}
