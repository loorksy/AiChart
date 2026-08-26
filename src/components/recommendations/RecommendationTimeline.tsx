"use client";

/**
 * The recommendation's event timeline, rendered from the SAME pure projection
 * the detail API serves (buildRecommendationTimeline) so the mini strip on a
 * list card and the full ledger on the detail page can never disagree.
 *
 * Two variants:
 *  - "mini": one horizontal strip of event chips for the list card — icon +
 *    short label, tooltip carries the timestamp.
 *  - "full": the professional ledger — a vertical rail with timestamp, price
 *    and R per event, newest last (the order the plan lived it).
 */
import {
  Ban,
  CheckCircle2,
  Clock3,
  EyeOff,
  FilePlus2,
  Hourglass,
  Replace,
  Shield,
  ShieldAlert,
  Target,
  Zap,
} from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import type {
  RecommendationTimelineEvent,
  TimelineEventType,
} from "@/lib/recommendations/timeline";
import { cn } from "@/lib/utils";

const EVENT_ICON: Record<TimelineEventType, typeof Zap> = {
  issued: FilePlus2,
  activated: Zap,
  tp1_hit: Target,
  tp2_hit: Target,
  tp3_hit: CheckCircle2,
  stop_breach_survived: ShieldAlert,
  stopped: Shield,
  expired: Hourglass,
  missed_opportunity: EyeOff,
  invalidated: Ban,
  superseded: Replace,
  cancelled: Ban,
};

/** Status tone per event — win/loss/neutral, never direction colour. */
const EVENT_TONE: Record<TimelineEventType, string> = {
  issued: "text-muted-foreground",
  activated: "text-info",
  tp1_hit: "text-buy",
  tp2_hit: "text-buy",
  tp3_hit: "text-buy",
  stop_breach_survived: "text-warning",
  stopped: "text-sell",
  expired: "text-muted-foreground",
  missed_opportunity: "text-warning",
  invalidated: "text-sell",
  superseded: "text-muted-foreground",
  cancelled: "text-muted-foreground",
};

function fmtR(value: number | null): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}R`;
}

/** App-locale timestamp — never the browser locale (Arabic-first UI). */
function fmtTime(ms: number, locale: string): string {
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

export function RecommendationTimeline({
  events,
  variant = "full",
}: {
  events: RecommendationTimelineEvent[];
  variant?: "full" | "mini";
}) {
  const { t, locale } = useLocale();
  if (!events.length) return null;

  if (variant === "mini") {
    return (
      <ol
        data-testid="recommendation-timeline-mini"
        className="flex flex-wrap items-center gap-1"
        aria-label={t("rec.timeline.title")}
      >
        {events.map((event, i) => {
          const Icon = EVENT_ICON[event.type];
          return (
            <li key={`${event.type}-${event.at}-${i}`} className="flex items-center gap-1">
              {i > 0 ? <span className="h-px w-2 bg-border" aria-hidden /> : null}
              <span
                title={`${t(`rec.timeline.${event.type}`)} · ${fmtTime(event.at, locale)}`}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border border-border/60 bg-muted/30 px-1.5 py-0.5 text-[10px]",
                  EVENT_TONE[event.type],
                )}
              >
                <Icon className="h-3 w-3 shrink-0" aria-hidden />
                <span className="sr-only">{t(`rec.timeline.${event.type}`)}</span>
                {event.count && event.count > 1 ? (
                  <span className="font-mono tabular-nums" dir="ltr">
                    ×{event.count}
                  </span>
                ) : null}
              </span>
            </li>
          );
        })}
      </ol>
    );
  }

  return (
    <ol
      data-testid="recommendation-timeline"
      className="relative space-y-0"
      aria-label={t("rec.timeline.title")}
    >
      {events.map((event, i) => {
        const Icon = EVENT_ICON[event.type];
        const r = fmtR(event.r);
        const last = i === events.length - 1;
        return (
          <li key={`${event.type}-${event.at}-${i}`} className="relative flex gap-3">
            {/* Rail: node + connector, mirrored for free under RTL because the
                offsets are logical. */}
            <div className="flex flex-col items-center">
              <span
                className={cn(
                  "z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border bg-card",
                  EVENT_TONE[event.type],
                )}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden />
              </span>
              {!last ? <span className="w-px flex-1 bg-border/70" aria-hidden /> : null}
            </div>
            <div className={cn("min-w-0 flex-1", !last && "pb-3")}>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span className={cn("text-[12px] font-semibold", EVENT_TONE[event.type])}>
                  {t(`rec.timeline.${event.type}`)}
                  {event.count && event.count > 1 ? (
                    <span className="ms-1 font-mono text-[11px] tabular-nums" dir="ltr">
                      ×{event.count}
                    </span>
                  ) : null}
                </span>
                {r ? (
                  <span
                    className={cn(
                      "font-mono text-[11px] font-bold tabular-nums",
                      event.r! >= 0 ? "text-buy" : "text-sell",
                    )}
                    dir="ltr"
                  >
                    {r}
                  </span>
                ) : null}
              </div>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <Clock3 className="h-3 w-3 shrink-0" aria-hidden />
                  <span className="font-mono tabular-nums" dir="ltr">
                    {fmtTime(event.at, locale)}
                  </span>
                </span>
                {event.price != null ? (
                  <span className="font-mono tabular-nums text-foreground/80" dir="ltr">
                    @{event.price}
                  </span>
                ) : null}
              </p>
              {event.detail ? (
                <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                  {event.detail}
                </p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
