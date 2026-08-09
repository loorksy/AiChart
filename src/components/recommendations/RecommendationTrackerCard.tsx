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
  XCircle,
} from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { smartTipKey } from "@/lib/recommendations/smartTip";
import type {
  TrackedRecommendation,
  TrackedRecommendationStatus,
} from "@/lib/recommendations/types";
import { cn } from "@/lib/utils";

type ExecutionState = NonNullable<TrackedRecommendation["executionState"]>;

/**
 * Presentation adds `cancelled` on top of the execution-state union: a
 * withdrawn plan is not "blocked" (an execution obstacle) and rendering it as
 * one contradicted the smart tip on the same card.
 */
type DisplayState = ExecutionState | "cancelled";

/** Records written before `executionState` existed still have to render. */
function deriveDisplayState(rec: TrackedRecommendation): DisplayState {
  if (rec.status === "cancelled" || rec.outcome === "cancelled") {
    return "cancelled";
  }
  if (rec.executionState) return rec.executionState;
  const terminal: Partial<Record<TrackedRecommendationStatus, DisplayState>> = {
    expired: "expired",
    invalidated: "invalidated",
  };
  const mapped = terminal[rec.status];
  if (mapped) return mapped;
  const waiting =
    rec.activationClass === "conditional" ||
    (rec.status === "pending_entry" && rec.entryType !== "market");
  return waiting ? "awaiting_activation" : "valid_now";
}

/**
 * Chip tones per state — mirrors the canonical EXEC_STATE_CLASSES in
 * ActiveRecommendationsPanel (DESIGN.md §4: copy those, don't reinvent).
 */
const PILL_CLASSES: Record<DisplayState, string> = {
  valid_now: "border-buy/45 bg-buy/10 text-buy",
  awaiting_activation: "border-warning/40 bg-warning/10 text-warning",
  expired: "border-border bg-muted/40 text-muted-foreground",
  invalidated: "border-destructive/40 bg-destructive/10 text-destructive",
  blocked: "border-destructive/40 bg-destructive/10 text-destructive",
  cancelled: "border-border bg-muted/40 text-muted-foreground",
};

/** Closed-trade tones: status (win/loss) rather than direction — §2 hard rule. */
const PILL_WON = "border-success/45 bg-success/10 text-success";
const PILL_LOST = "border-destructive/40 bg-destructive/10 text-destructive";

/** Setup types with a translation; anything else renders its raw label. */
const KNOWN_SETUP_TYPES = new Set([
  "scalp",
  "trend_continuation",
  "reversal_after_sweep",
  "range_boundary",
  "breakout_retest",
]);

function fmtR(value?: number): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}R`;
}

/** App-locale timestamp — never the browser locale (Arabic-first UI). */
function fmtTime(ms: number | undefined, locale: string): string {
  if (!ms) return "";
  try {
    return new Date(ms).toLocaleString(locale === "ar" ? "ar" : "en", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

/**
 * Copy-to-clipboard for one price. Visually a 12px icon; the hit area is
 * expanded to ≥44px via the ::after inset so the mobile touch target rule
 * (DESIGN.md §8) holds without inflating the dense levels grid.
 */
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
      className="relative inline-flex size-4 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors after:absolute after:-inset-3.5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:after:-inset-2.5"
    >
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
    </button>
  );
}

/**
 * The recommendation as a signal card: a direction banner that says BUY or
 * SELL before a single number is read, above a content panel carrying the
 * narrative, the price, and the levels with their live hit state.
 *
 * Layout adapts to the CONTAINER, not the viewport — the card lives inside a
 * width-capped chat pane (320–560px) on a ≥1280px desktop, where viewport
 * breakpoints lie about the available space. `@container` on the root drives
 * every variant: the banner becomes a start-side column only when the card
 * itself is ≥42rem wide (recommendations pages), and the levels grid steps
 * 2 → 3 → 5 columns with the card's own width. Mirrored automatically under
 * RTL because every offset is logical. Direction is never colour alone — the
 * word, an arrow, and the banner all say it, so a red/green-blind reader
 * loses nothing.
 */
export function RecommendationTrackerCard({
  rec,
}: {
  rec: TrackedRecommendation;
}) {
  const { t, dir, locale } = useLocale();

  const displayState = deriveDisplayState(rec);
  const isBuy = rec.direction === "buy";
  const DirIcon = isBuy ? TrendingUp : TrendingDown;

  const won = rec.outcome.startsWith("win_");
  const lost = rec.outcome === "loss";

  const setupType = rec.setupType ?? "scalp";
  const setupLabel = KNOWN_SETUP_TYPES.has(setupType)
    ? t(`rec.setup_type.${setupType}`)
    : setupType;

  /** The status pill inside the direction banner: the one-phrase state. */
  const pill = won
    ? {
        icon: CheckCircle2,
        label: t(`rec.status.${rec.status}`),
        tone: PILL_WON,
      }
    : lost
      ? { icon: Shield, label: t("rec.status.sl_hit"), tone: PILL_LOST }
      : displayState === "cancelled"
        ? {
            icon: XCircle,
            label: t("rec.status.cancelled"),
            tone: PILL_CLASSES.cancelled,
          }
        : {
            icon: Clock3,
            label: t(`rec.exec_state.${displayState}`),
            tone: PILL_CLASSES[displayState],
          };

  /** The footer sentence: what is true about this plan right now. */
  const footerText = won
    ? t("rec.footer.closed_win")
    : lost
      ? t("rec.footer.closed_loss")
      : t(`rec.footer.${displayState}`);

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
      data-execution-state={displayState}
      data-testid="recommendation-card"
      className="@container overflow-hidden rounded-xl border border-border bg-card text-sm"
    >
      <div className="flex flex-col @2xl:flex-row">
        {/* Direction banner — the verdict, readable before any number.
            Flat direction tint on the card surface (no gradients — §1);
            becomes a start-side column only when the CARD is ≥42rem wide. */}
        <div
          className={cn(
            "flex shrink-0 flex-col gap-2.5 border-b border-border/60 p-3 @2xl:w-52 @2xl:border-b-0 @2xl:border-e",
            isBuy ? "bg-buy/10" : "bg-sell/10",
          )}
        >
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="rounded-full border border-border bg-card px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
              {setupLabel}
            </span>
            <span
              className="rounded-full border border-border bg-card px-2 py-0.5 font-mono text-[11px] font-medium tabular-nums text-muted-foreground"
              dir="ltr"
            >
              {rec.interval}
            </span>
            {rec.planType && (
              <span className="rounded-full border border-border bg-card px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                {t("rec.detail.plan_type")}: {t(`rec.plan_type.${rec.planType}`)}
              </span>
            )}
          </div>

          {/* Narrow container: verdict and pill share a row. Wide container
              (side column): they stack under each other. */}
          <div className="flex flex-wrap items-center justify-between gap-2 @2xl:flex-col @2xl:items-start">
            <div className="min-w-0">
              <p
                className={cn(
                  "text-[11px] font-semibold uppercase tracking-wider",
                  isBuy ? "text-buy" : "text-sell",
                )}
              >
                {isBuy ? t("rec.card.buy") : t("rec.card.sell")}
              </p>
              <p
                className={cn(
                  "mt-0.5 flex items-center gap-2 font-mono text-xl font-extrabold tracking-tight @sm:text-2xl",
                  isBuy ? "text-buy" : "text-sell",
                )}
                dir="ltr"
              >
                {rec.symbol}
                <DirIcon className="h-5 w-5 shrink-0" aria-hidden />
              </p>
            </div>

            <span
              className={cn(
                "inline-flex w-fit shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold",
                pill.tone,
              )}
            >
              <pill.icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
              {pill.label}
            </span>
          </div>
        </div>

        {/* Content panel — the narrative and the numbers. */}
        <div className="flex min-w-0 flex-1 flex-col">
          {(rec.triggerCondition || rec.priceAtCreation != null) && (
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/60 p-3">
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
                      className="font-mono text-lg font-extrabold tabular-nums text-foreground @sm:text-xl"
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
          )}

          {/* Levels: 2 → 3 → 5 columns as the CARD (not the viewport) widens,
              so five mono prices never squeeze into a 320px chat pane. */}
          <div className="grid grid-cols-2 gap-x-3 gap-y-3 p-3 @sm:grid-cols-3 @3xl:grid-cols-5">
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
                    title={level.hitAt ? fmtTime(level.hitAt, locale) : undefined}
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
          <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border/60 px-3 py-2.5 text-[11px] text-muted-foreground">
            <span className="min-w-0 flex-1">{footerText}</span>
            {closedAt ? (
              <span className="shrink-0 font-mono tabular-nums" dir="ltr">
                {fmtTime(closedAt, locale)}
              </span>
            ) : null}
            {netR ? (
              <span
                className={cn(
                  "shrink-0 font-mono font-bold tabular-nums",
                  won ? "text-buy" : "text-sell",
                )}
                dir="ltr"
              >
                {netR}
              </span>
            ) : null}
          </div>

          {/* Smart tip — the platform's own read on what to do with the card. */}
          <div className="flex items-start gap-2 border-t border-border/40 bg-muted/50 px-3 py-2.5">
            <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" aria-hidden />
            <p className="min-w-0 text-xs text-foreground">{t(smartTipKey(rec))}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
