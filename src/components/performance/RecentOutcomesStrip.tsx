"use client";

/**
 * The latest terminal results as a strip of chips, newest first — each chip
 * links to its recommendation's detail page. Colour is the RESULT (win/loss/
 * neutral), never the direction; the R value says the rest.
 */
import Link from "next/link";
import { useLocale } from "@/hooks/useLocale";
import type { RecentOutcome } from "@/lib/recommendations/recommendationStats";
import { gradeIsLoss, gradeIsWin } from "@/lib/recommendations/tradeMetrics";
import { cn } from "@/lib/utils";

export function RecentOutcomesStrip({ outcomes }: { outcomes: RecentOutcome[] }) {
  const { t } = useLocale();
  if (outcomes.length === 0) return null;

  return (
    <div className="glass-card p-3" data-testid="recent-outcomes">
      <h3 className="mb-2 text-sm font-semibold text-foreground">
        {t("stats.recent_outcomes")}
      </h3>
      <div className="flex flex-wrap gap-1.5">
        {outcomes.map((o) => {
          const win = gradeIsWin(o.grade);
          const loss = gradeIsLoss(o.grade);
          return (
            <Link
              key={o.id}
              href={`/recommendations/${o.id}`}
              title={t(`rec.grade.${o.grade}`)}
              className={cn(
                "inline-flex min-h-8 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                win
                  ? "border-buy/40 bg-buy/10 text-buy hover:bg-buy/15"
                  : loss
                    ? "border-destructive/40 bg-destructive/10 text-destructive hover:bg-destructive/15"
                    : "border-border bg-muted/40 text-muted-foreground hover:bg-muted/60",
              )}
            >
              <span dir="ltr" className="font-mono tabular-nums">
                {o.direction === "buy" ? "▲" : "▼"}
              </span>
              {o.r != null ? (
                <span dir="ltr" className="font-mono tabular-nums">
                  {o.r > 0 ? "+" : ""}
                  {o.r.toFixed(2)}R
                </span>
              ) : (
                <span>{t(`rec.grade.${o.grade}`)}</span>
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
