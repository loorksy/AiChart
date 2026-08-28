"use client";

import Link from "next/link";
import {
  ChevronLeft,
  ChevronRight,
  LogIn,
  Shield,
  Target,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { formatSignedR } from "@/lib/recommendations/tradeMetrics";
import { displayROf } from "@/lib/recommendations/tradeMetricsSummary";
import type { TrackedRecommendation } from "@/lib/recommendations/types";
import { cn } from "@/lib/utils";

/**
 * The signal as the agent's own card language: the verdict (BUY or SELL) and
 * the three numbers that define the plan — nothing else. Everything the full
 * report says (evidence, trace, activation, validity) lives on the standalone
 * details page this card links to. Deliberately NO execution-state pill here:
 * the list never says "wait" — a signal is a buy or a sell, and the reader
 * opens the details for the plan's lifecycle.
 */
export function CompactSignalCard({ rec }: { rec: TrackedRecommendation }) {
  const { t, dir } = useLocale();
  const isBuy = rec.direction === "buy";
  const DirIcon = isBuy ? TrendingUp : TrendingDown;
  const Chevron = dir === "rtl" ? ChevronLeft : ChevronRight;

  const shownR = displayROf(rec, rec.priceAtCreation);
  const netR = formatSignedR(shownR);

  const levels = [
    { key: "entry", label: t("rec.row.entry"), value: rec.entry, icon: LogIn, tone: "text-foreground" },
    { key: "sl", label: t("rec.row.stop_loss"), value: rec.stopLoss, icon: Shield, tone: "text-sell" },
    ...(rec.targets.length
      ? [{ key: "tp1", label: t("rec.row.target1"), value: rec.targets[0]!, icon: Target, tone: "text-buy" }]
      : []),
  ];

  return (
    <Link
      href={`/recommendations/${rec.id}`}
      dir={dir}
      data-testid="compact-signal-card"
      className={cn(
        "group block rounded-lg border px-3 py-2.5 text-[12px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        isBuy
          ? "border-buy/35 bg-buy/[0.06] hover:bg-buy/10"
          : "border-sell/35 bg-sell/[0.06] hover:bg-sell/10",
      )}
    >
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
        {netR ? (
          <span
            className={cn(
              "ms-auto shrink-0 font-mono text-[12px] font-bold tabular-nums",
              (shownR ?? 0) >= 0 ? "text-buy" : "text-sell",
            )}
            dir="ltr"
          >
            {netR}
          </span>
        ) : null}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5">
        {levels.map((level) => (
          <span key={level.key} className="inline-flex items-center gap-1.5">
            <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <level.icon className="h-3 w-3 shrink-0" aria-hidden />
              {level.label}
            </span>
            <span
              className={cn("font-mono text-[12px] font-bold tabular-nums", level.tone)}
              dir="ltr"
            >
              {level.value}
            </span>
          </span>
        ))}
        <span className="ms-auto inline-flex shrink-0 items-center gap-0.5 text-[11px] font-medium text-muted-foreground transition-colors group-hover:text-foreground">
          {t("rec.card.read_details")}
          <Chevron className="h-3.5 w-3.5 shrink-0" aria-hidden />
        </span>
      </div>
    </Link>
  );
}
