"use client";

/**
 * The plan's OUTCOME SUMMARY on the detail page: grade, realized R, MFE/MAE,
 * durations, exit facts, survived stop breaches. Reads the same projection
 * the API serves (tradeMetricsSummary.ts); rows the sweep never measured say
 * "not measured" — the record never invents a number.
 */
import { Award, ShieldAlert } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { formatDurationMs } from "@/lib/display/duration";
import type { TradeMetricsSummary } from "@/lib/recommendations/tradeMetricsSummary";
import { cn } from "@/lib/utils";

function fmtR(value: number | null): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}R`;
}

function Cell({
  label,
  value,
  tone,
  mono = true,
}: {
  label: string;
  value: string;
  tone?: string;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "mt-0.5 text-[13px] font-semibold tabular-nums",
          mono && "font-mono",
          tone ?? "text-foreground",
        )}
        dir={mono ? "ltr" : undefined}
      >
        {value}
      </dd>
    </div>
  );
}

export function OutcomeSummaryPanel({ summary }: { summary: TradeMetricsSummary }) {
  const { t, locale } = useLocale();
  const dl = locale === "ar" ? "ar" : "en";
  const na = t("rec.summary.not_measured");

  const realized = fmtR(summary.realizedR);
  const mfe = fmtR(summary.mfeR);
  const mae = fmtR(summary.maeR);
  const toActivation = formatDurationMs(summary.timeToActivationMs, dl);
  const inTrade = formatDurationMs(summary.timeInTradeMs, dl);

  return (
    <div
      data-testid="outcome-summary"
      className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2"
    >
      <p className="flex items-center gap-1.5 text-[12px] font-semibold text-foreground">
        <Award className="h-3.5 w-3.5" aria-hidden />
        {t("rec.summary.title")}
        <span className="ms-auto rounded-full border border-border bg-card px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
          {t(`rec.grade.${summary.grade}`)}
        </span>
      </p>

      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
        <Cell
          label={t("rec.summary.realized_r")}
          value={realized ?? na}
          tone={
            summary.realizedR == null
              ? "text-muted-foreground"
              : summary.realizedR >= 0
                ? "text-buy"
                : "text-sell"
          }
          mono={realized != null}
        />
        <Cell
          label={t("rec.summary.mfe")}
          value={mfe ?? na}
          tone={mfe != null ? "text-buy" : "text-muted-foreground"}
          mono={mfe != null}
        />
        <Cell
          label={t("rec.summary.mae")}
          value={mae ?? na}
          tone={mae != null ? "text-sell" : "text-muted-foreground"}
          mono={mae != null}
        />
        <Cell
          label={t("rec.summary.time_to_activation")}
          value={toActivation ?? na}
          tone={toActivation != null ? undefined : "text-muted-foreground"}
          mono={toActivation != null}
        />
        <Cell
          label={t("rec.summary.time_in_trade")}
          value={inTrade ?? na}
          tone={inTrade != null ? undefined : "text-muted-foreground"}
          mono={inTrade != null}
        />
        {summary.exitPrice != null ? (
          <Cell label={t("rec.summary.exit_price")} value={String(summary.exitPrice)} />
        ) : null}
      </dl>

      {summary.stopBreachSurvivedCount > 0 ? (
        <p className="mt-2 flex items-center gap-1.5 text-[11px] text-warning">
          <ShieldAlert className="h-3.5 w-3.5 shrink-0" aria-hidden />
          {t("rec.summary.stop_breaches")}:{" "}
          <span className="font-mono font-bold tabular-nums" dir="ltr">
            {summary.stopBreachSurvivedCount}
          </span>
        </p>
      ) : null}
    </div>
  );
}
