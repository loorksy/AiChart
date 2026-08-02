"use client";

import { useState } from "react";
import {
  Check,
  CheckCircle2,
  Clock3,
  Copy,
  Lightbulb,
  Shield,
  Target,
  TrendingDown,
  TrendingUp,
  LogIn,
} from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { smartTipKey } from "@/lib/recommendations/smartTip";
import type {
  TrackedRecommendation,
  TrackedRecommendationStatus,
} from "@/lib/recommendations/types";
import { cn } from "@/lib/utils";

type ExecutionState = NonNullable<TrackedRecommendation["executionState"]>;

/** Records written before `executionState` existed still have to render. */
function deriveExecutionState(rec: TrackedRecommendation): ExecutionState {
  if (rec.executionState) return rec.executionState;
  const terminal: Partial<Record<TrackedRecommendationStatus, ExecutionState>> = {
    expired: "expired",
    invalidated: "invalidated",
    cancelled: "blocked",
  };
  const mapped = terminal[rec.status];
  if (mapped) return mapped;
  const waiting =
    rec.activationClass === "conditional" ||
    (rec.status === "pending_entry" && rec.entryType !== "market");
  return waiting ? "awaiting_activation" : "valid_now";
}

function fmtR(value?: number): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}R`;
}

function fmtTime(ms?: number): string {
  if (!ms) return "";
  try {
    return new Date(ms).toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function CopyPrice({ value }: { value: number }) {
  const [copied, setCopied] = useState(false);
  const { t } = useLocale();
  return (
    <button
      type="button"
      aria-label={copied ? t("rec.copied") : t("rec.copy")}
      onClick={() => {
        void navigator.clipboard?.writeText(String(value)).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        });
      }}
      className="text-muted-foreground transition-colors hover:text-foreground"
    >
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
    </button>
  );
}

/**
 * The recommendation as a signal card: a saturated direction panel that says
 * BUY or SELL before a single number is read, beside a content panel carrying
 * the narrative, the price, and the levels with their live hit state.
 *
 * The two-panel split follows the reference design: side-by-side from `sm`,
 * stacked banner-over-content on phones, mirrored automatically under RTL
 * because every offset is logical. Direction is never colour alone — the word,
 * an arrow, and the panel all say it, so a red/green-blind reader loses
 * nothing.
 */
export function RecommendationTrackerCard({
  rec,
}: {
  rec: TrackedRecommendation;
}) {
  const { t, dir } = useLocale();

  const execState = deriveExecutionState(rec);
  const isBuy = rec.direction === "buy";
  const DirIcon = isBuy ? TrendingUp : TrendingDown;

  const won = rec.outcome.startsWith("win_");
  const lost = rec.outcome === "loss";

  /** The status pill inside the direction panel: the one-phrase state. */
  const pill = won
    ? { icon: CheckCircle2, label: t(`rec.status.${rec.status}`) }
    : lost
      ? { icon: Shield, label: t("rec.status.sl_hit") }
      : { icon: Clock3, label: t(`rec.exec_state.${execState}`) };

  /** The footer sentence: what is true about this plan right now. */
  const footerText = won
    ? t("rec.footer.closed_win")
    : lost
      ? t("rec.footer.closed_loss")
      : t(`rec.footer.${execState}`);

  const closedAt = won
    ? (rec.tp3HitAt ?? rec.tp2HitAt ?? rec.tp1HitAt)
    : lost
      ? rec.slHitAt
      : undefined;

  const netR = won ? fmtR(rec.netRr ?? rec.rr) : lost ? fmtR(-1) : null;

  const levels = [
    {
      key: "entry",
      label: t("rec.row.entry"),
      value: rec.entry,
      icon: LogIn,
      tone: "text-foreground",
      hitAt: rec.triggeredAt,
      showBadge: false,
    },
    {
      key: "sl",
      label: t("rec.row.stop_loss"),
      value: rec.stopLoss,
      icon: Shield,
      tone: "text-sell",
      hitAt: rec.slHitAt,
      showBadge: Boolean(rec.slHitAt),
    },
    ...rec.targets.slice(0, 3).map((value, i) => {
      const hitAt = [rec.tp1HitAt, rec.tp2HitAt, rec.tp3HitAt][i];
      return {
        key: `tp${i + 1}`,
        label: t(`rec.row.target${i + 1}`),
        value,
        icon: Target,
        tone: "text-buy",
        hitAt,
        // Badges only once the trade is in play; a waiting plan has nothing
        // to grade yet — the reference's two variants differ exactly here.
        showBadge: Boolean(rec.triggeredAt) || won || lost,
      };
    }),
  ];

  return (
    <div
      dir={dir}
      data-execution-state={execState}
      data-testid="recommendation-card"
      className="overflow-hidden rounded-2xl border border-border bg-card text-sm shadow-sm"
    >
      <div className="flex flex-col sm:flex-row">
        {/* Direction panel — the verdict, readable from across the room. */}
        <div
          className={cn(
            "relative flex shrink-0 flex-col gap-3 p-4 text-white sm:w-52",
            isBuy ? "bg-buy" : "bg-sell",
          )}
        >
          {/* Depth without a second colour: one soft light-to-dark wash. */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-gradient-to-br from-white/15 via-transparent to-black/25"
          />
          <div className="relative flex items-center gap-2">
            <span className="rounded-full bg-white/15 px-2.5 py-1 text-[10px] font-semibold">
              {rec.setupType ?? "scalp"}
            </span>
            <span
              className="rounded-full bg-white/15 px-2.5 py-1 text-[10px] font-semibold tabular-nums"
              dir="ltr"
            >
              {rec.interval}
            </span>
          </div>

          <div className="relative">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-white/85">
              {isBuy ? t("rec.card.buy") : t("rec.card.sell")}
            </p>
            <p
              className="mt-0.5 flex items-center gap-2 text-2xl font-extrabold tracking-tight"
              dir="ltr"
            >
              {rec.symbol}
              <DirIcon className="h-6 w-6 shrink-0" aria-hidden />
            </p>
          </div>

          <div
            className={cn(
              "relative flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-xs font-bold",
              isBuy ? "text-buy" : "text-sell",
            )}
          >
            <pill.icon className="h-4 w-4 shrink-0" aria-hidden />
            {pill.label}
          </div>

          {rec.planType && (
            <span className="relative w-fit rounded-full bg-white/15 px-2.5 py-1 text-[10px] font-semibold">
              {t("rec.detail.plan_type")}: {t(`rec.plan_type.${rec.planType}`)}
            </span>
          )}
        </div>

        {/* Content panel — the narrative and the numbers. */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/60 p-4">
            {rec.triggerCondition ? (
              <p className="min-w-0 flex-1 text-[13px] leading-relaxed text-foreground">
                {rec.triggerCondition}
              </p>
            ) : (
              <span className="min-w-0 flex-1" />
            )}
            {rec.priceAtCreation != null && (
              <div className="flex shrink-0 items-center gap-2.5">
                <div className="text-end">
                  <p className="text-[10px] text-muted-foreground">
                    {t("rec.row.current_price")}
                  </p>
                  <p
                    className="text-xl font-extrabold tabular-nums text-foreground"
                    dir="ltr"
                  >
                    {rec.priceAtCreation}
                  </p>
                </div>
                <span
                  className={cn(
                    "flex h-10 w-10 items-center justify-center rounded-lg",
                    isBuy ? "bg-buy/10 text-buy" : "bg-sell/10 text-sell",
                  )}
                >
                  <DirIcon className="h-5 w-5" aria-hidden />
                </span>
              </div>
            )}
          </div>

          {/* Levels: five columns on desktop, wrapping pairs on a phone. */}
          <div className="grid grid-cols-2 gap-x-2 gap-y-3 p-4 sm:grid-cols-3 lg:grid-cols-5">
            {levels.map((level) => (
              <div key={level.key} className="min-w-0">
                <p className="flex items-center gap-1 text-[10px] text-muted-foreground">
                  <level.icon className="h-3 w-3 shrink-0" aria-hidden />
                  {level.label}
                </p>
                <p className="mt-0.5 flex items-center gap-1.5">
                  <span
                    className={cn(
                      "font-mono text-sm font-bold tabular-nums",
                      level.tone,
                    )}
                    dir="ltr"
                  >
                    {level.value}
                  </span>
                  <CopyPrice value={level.value} />
                </p>
                {level.showBadge && (
                  <span
                    title={level.hitAt ? fmtTime(level.hitAt) : undefined}
                    className={cn(
                      "mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-semibold",
                      level.hitAt
                        ? "bg-buy/15 text-buy"
                        : "bg-muted text-muted-foreground",
                    )}
                  >
                    {level.hitAt ? <Check className="h-2.5 w-2.5" aria-hidden /> : null}
                    {level.hitAt ? t("rec.badge.hit") : t("rec.badge.pending")}
                  </span>
                )}
              </div>
            ))}
          </div>

          {/* Footer: state sentence, close time, net result. */}
          <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border/60 px-4 py-2.5 text-[11px] text-muted-foreground">
            <span className="min-w-0 flex-1">{footerText}</span>
            {closedAt ? (
              <span className="shrink-0 tabular-nums" dir="ltr">
                {fmtTime(closedAt)}
              </span>
            ) : null}
            {netR ? (
              <span
                className={cn(
                  "shrink-0 font-bold tabular-nums",
                  won ? "text-buy" : "text-sell",
                )}
                dir="ltr"
              >
                {netR}
              </span>
            ) : null}
          </div>

          {/* Smart tip — the platform's own read on what to do with the card. */}
          <div className="flex items-start gap-2 border-t border-border/40 bg-background/50 px-4 py-2.5">
            <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" aria-hidden />
            <p className="text-xs text-foreground">{t(smartTipKey(rec))}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
