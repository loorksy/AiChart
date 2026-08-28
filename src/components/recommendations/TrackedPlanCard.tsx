"use client";

/**
 * One recommendation as a professional TRACKING record on the list page:
 * the verdict (BUY/SELL), the plan's levels, the grade chip, the live
 * progress toward the next untaken target (anchored at the effective entry,
 * current-price marker on the bar), R so far, time since activation, and the
 * mini event timeline — every number a projection of the same persisted
 * record the detail page renders, via tradeMetricsSummary/timeline.
 *
 * Deliberately link-shaped: the whole card opens the plan's detail page;
 * nothing here mutates anything.
 */
import Link from "next/link";
import {
  ChevronLeft,
  ChevronRight,
  Clock3,
  LogIn,
  Shield,
  Target,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { formatDurationMs } from "@/lib/display/duration";
import { buildRecommendationTimeline } from "@/lib/recommendations/timeline";
import type { RecommendationGrade } from "@/lib/recommendations/tradeMetrics";
import {
  computeTradeMetricsSummary,
  liveRSoFar,
  progressTowardNextTarget,
} from "@/lib/recommendations/tradeMetricsSummary";
import type { TrackedRecommendation } from "@/lib/recommendations/types";
import { RecommendationTimeline } from "@/components/recommendations/RecommendationTimeline";
import { ShareProfitButton } from "@/components/recommendations/ShareProfitButton";
import { cn } from "@/lib/utils";

/** Grade chip tones: result colour (win/loss/neutral), never direction. */
const GRADE_TONES: Record<RecommendationGrade, string> = {
  win_tp3: "border-buy/45 bg-buy/10 text-buy",
  win_tp2: "border-buy/45 bg-buy/10 text-buy",
  win_tp1: "border-buy/45 bg-buy/10 text-buy",
  loss: "border-destructive/40 bg-destructive/10 text-destructive",
  expired_in_profit: "border-buy/30 bg-buy/5 text-buy",
  expired_in_loss: "border-destructive/30 bg-destructive/5 text-destructive",
  expired_in_trade: "border-border bg-muted/40 text-muted-foreground",
  missed_opportunity: "border-warning/40 bg-warning/10 text-warning",
  expired_untriggered: "border-border bg-muted/40 text-muted-foreground",
  invalidated_before_entry: "border-border bg-muted/40 text-muted-foreground",
  invalidated_in_trade: "border-destructive/30 bg-destructive/5 text-destructive",
  superseded: "border-border bg-muted/40 text-muted-foreground",
  cancelled: "border-border bg-muted/40 text-muted-foreground",
  active: "border-info/40 bg-info/10 text-info",
  pending_entry: "border-warning/40 bg-warning/10 text-warning",
};

function fmtR(value: number | null | undefined): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}R`;
}

export function TrackedPlanCard({
  rec,
  livePrice,
  now,
}: {
  rec: TrackedRecommendation;
  /** Latest quote for the plan's symbol; live progress renders only with it. */
  livePrice?: number | null;
  /** The list's load clock — passed in so render stays pure. */
  now: number;
}) {
  const { t, dir, locale } = useLocale();
  const isBuy = rec.direction === "buy";
  const DirIcon = isBuy ? TrendingUp : TrendingDown;
  const Chevron = dir === "rtl" ? ChevronLeft : ChevronRight;

  const summary = computeTradeMetricsSummary(rec, now);
  const timeline = buildRecommendationTimeline(rec);
  const grade = summary.grade;
  const live = rec.outcome === "pending" && Boolean(rec.triggeredAt);

  const rSoFar = live ? liveRSoFar(rec, livePrice) : null;
  const progress = live ? progressTowardNextTarget(rec, livePrice) : null;
  const shownR = summary.terminal ? summary.realizedR : rSoFar;
  const inTradeFor = live ? formatDurationMs(now - (rec.triggeredAt ?? now), locale === "ar" ? "ar" : "en") : null;

  const entry = rec.effectiveEntry ?? rec.entry;

  const levels = [
    { key: "entry", label: t("rec.row.entry"), value: rec.entry, icon: LogIn, tone: "text-foreground", hitAt: rec.triggeredAt },
    { key: "sl", label: t("rec.row.stop_loss"), value: rec.stopLoss, icon: Shield, tone: "text-sell", hitAt: rec.slHitAt },
    ...rec.targets.slice(0, 3).map((value, i) => ({
      key: `tp${i + 1}`,
      label: t(`rec.row.target${i + 1}`),
      value,
      icon: Target,
      tone: "text-buy",
      hitAt: [rec.tp1HitAt, rec.tp2HitAt, rec.tp3HitAt][i],
    })),
  ];

  return (
    <div className="relative">
    <Link
      href={`/recommendations/${rec.id}`}
      dir={dir}
      data-testid="tracked-plan-card"
      className="group block rounded-xl border border-border bg-card p-3 pe-12 transition-colors hover:border-foreground/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {/* Header: verdict, symbol, interval, grade chip, R. */}
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={cn(
            "inline-flex items-center gap-1.5 text-sm font-bold",
            isBuy ? "text-buy" : "text-sell",
          )}
        >
          <DirIcon className="h-4 w-4 shrink-0" aria-hidden />
          {isBuy ? t("rec.card.buy") : t("rec.card.sell")}
        </span>
        <span className="font-mono text-sm font-semibold text-foreground" dir="ltr">
          {rec.symbol}
        </span>
        <span
          className="rounded-full border border-border bg-card px-2 py-0.5 font-mono text-[11px] tabular-nums text-muted-foreground"
          dir="ltr"
        >
          {rec.interval}
        </span>
        <span
          data-testid="grade-chip"
          className={cn(
            "rounded-full border px-2 py-0.5 text-[11px] font-semibold",
            GRADE_TONES[grade],
          )}
        >
          {t(`rec.grade.${grade}`)}
        </span>
        {shownR != null ? (
          <span
            className={cn(
              "ms-auto shrink-0 font-mono text-[13px] font-bold tabular-nums",
              shownR >= 0 ? "text-buy" : "text-sell",
            )}
            dir="ltr"
            title={summary.terminal ? t("rec.summary.realized_r") : t("rec.card.r_so_far")}
          >
            {fmtR(shownR)}
          </span>
        ) : null}
      </div>

      {/* Levels: tick-correct mono numbers with hit ticks. */}
      <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5">
        {levels.map((level) => (
          <span key={level.key} className="inline-flex items-center gap-1.5">
            <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <level.icon className="h-3 w-3 shrink-0" aria-hidden />
              {level.label}
            </span>
            <span
              className={cn(
                "font-mono text-[12px] font-bold tabular-nums",
                level.tone,
                level.hitAt ? "underline decoration-dotted underline-offset-2" : "",
              )}
              dir="ltr"
            >
              {level.value}
            </span>
          </span>
        ))}
      </div>

      {/* Live progress toward the next untaken target — only when a fresh
          quote exists; a stale bar is worse than no bar. */}
      {progress ? (
        <div className="mt-3" data-testid="live-progress">
          <div className="flex items-center justify-between text-[10px] text-muted-foreground">
            <span>{t("rec.card.progress_to_target", { n: String(progress.targetIndex) })}</span>
            <span className="font-mono tabular-nums" dir="ltr">
              {entry} → {progress.target}
            </span>
          </div>
          <div className="relative mt-1 h-1.5 overflow-hidden rounded-full bg-muted" dir="ltr">
            <div
              className={cn("h-full rounded-full", isBuy ? "bg-buy" : "bg-sell")}
              style={{ width: `${Math.round(progress.ratio * 100)}%` }}
            />
            {/* Current-price marker. */}
            <span
              className="absolute top-1/2 h-3 w-0.5 -translate-y-1/2 rounded bg-foreground"
              style={{ left: `${Math.round(progress.ratio * 100)}%` }}
              aria-hidden
            />
          </div>
        </div>
      ) : null}

      {/* Meta strip: time since activation (live) and the mini timeline. */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        {inTradeFor ? (
          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
            <Clock3 className="h-3 w-3 shrink-0" aria-hidden />
            {t("rec.card.in_trade_for")}{" "}
            <span className="font-mono tabular-nums" dir="ltr">
              {inTradeFor}
            </span>
          </span>
        ) : rec.outcome === "pending" && !rec.triggeredAt ? (
          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
            <Clock3 className="h-3 w-3 shrink-0" aria-hidden />
            {t("rec.card.awaiting_fill")}
          </span>
        ) : null}
        <span className="min-w-0">
          <RecommendationTimeline events={timeline} variant="mini" />
        </span>
        <span className="ms-auto inline-flex shrink-0 items-center gap-0.5 text-[11px] font-medium text-muted-foreground transition-colors group-hover:text-foreground">
          {t("rec.card.read_details")}
          <Chevron className="h-3.5 w-3.5 shrink-0" aria-hidden />
        </span>
      </div>
    </Link>
    <div className="absolute top-1.5 end-1.5 z-10">
      <ShareProfitButton rec={rec} livePrice={livePrice} />
    </div>
    </div>
  );
}
