"use client";

/**
 * Shared Quant Agent recommendation card. Originally defined inline (module-
 * scoped) in `QuantAgentFeedClient.tsx`; extracted here so
 * `QuantAgentChatMessage.tsx` (Quant Agent Chat's `explain_recommendation`
 * turns) can reuse it verbatim instead of duplicating the direction badge,
 * entry/stop/take_profit/confidence grid, targets list, strategy/regime/
 * validity line, and rationale block. Every card still carries the explicit
 * "Quant Agent" attribution badge — this output never passes through
 * createCanonicalRecommendation / applyRecommendationRevision.
 */
import {
  ArrowDownRight,
  ArrowUpRight,
  Radar,
} from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { cn } from "@/lib/utils";
import type { QuantRecommendation } from "@/lib/quantAgent/types";

export const PLAN_TYPE_LABEL: Record<string, string> = {
  immediate: "rec.plan_type.immediate",
  anticipatory: "rec.plan_type.anticipatory",
  conditional: "rec.plan_type.conditional",
};

export function formatNumber(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return String(value);
}

export function QuantRecommendationCard({ rec }: { rec: QuantRecommendation }) {
  const { t, dir, locale } = useLocale();
  const expires = rec.validity_expires_at
    ? new Date(rec.validity_expires_at).toLocaleString(locale === "ar" ? "ar" : "en", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  return (
    <div
      dir={dir}
      data-testid="quant-agent-recommendation-card"
      className="rounded-xl border border-border bg-card p-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={cn(
            "inline-flex items-center gap-1 text-sm font-bold",
            rec.direction === "buy" ? "text-buy" : "text-sell",
          )}
        >
          {rec.direction === "buy" ? (
            <ArrowUpRight className="h-4 w-4" aria-hidden />
          ) : (
            <ArrowDownRight className="h-4 w-4" aria-hidden />
          )}
          {t(`decision.${rec.direction}`)}
        </span>
        <span className="font-mono text-sm text-foreground">{rec.symbol}</span>
        <span className="text-[11px] text-muted-foreground">{rec.interval}</span>
        <span className="rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[11px] text-foreground">
          {t(PLAN_TYPE_LABEL[rec.plan_type] ?? "rec.plan_type.immediate")}
        </span>
        <span className="ms-auto inline-flex items-center gap-1 rounded-full border border-info/40 bg-info/10 px-2 py-0.5 text-[11px] font-medium text-info">
          <Radar className="h-3 w-3" aria-hidden />
          {t("qa.page.badge")}
        </span>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
        <div className="min-w-0">
          <dt className="text-[11px] text-muted-foreground">{t("qa.card.entry")}</dt>
          <dd className="font-mono text-[12px] text-foreground">{formatNumber(rec.entry)}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-[11px] text-muted-foreground">{t("qa.card.stop_loss")}</dt>
          <dd className="font-mono text-[12px] text-sell">{formatNumber(rec.stop_loss)}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-[11px] text-muted-foreground">{t("qa.card.take_profit")}</dt>
          <dd className="font-mono text-[12px] text-buy">{formatNumber(rec.take_profit)}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-[11px] text-muted-foreground">{t("qa.card.confidence")}</dt>
          <dd className="font-mono text-[12px] text-foreground">
            {Math.round(rec.confidence * 100)}%
          </dd>
        </div>
      </dl>

      {rec.targets.length ? (
        <p className="mt-2 text-[11px] text-muted-foreground">
          <span className="font-medium text-foreground/80">{t("qa.card.targets")}:</span>{" "}
          <span className="font-mono">{rec.targets.map((tgt) => formatNumber(tgt)).join(" · ")}</span>
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
        <span>
          <span className="font-medium text-foreground/80">{t("qa.card.strategy")}:</span>{" "}
          {rec.strategy_id} ({rec.strategy_version})
        </span>
        {rec.regime ? (
          <span>
            <span className="font-medium text-foreground/80">{t("qa.card.regime")}:</span> {rec.regime}
          </span>
        ) : null}
        <span>
          <span className="font-medium text-foreground/80">{t("qa.card.validity")}:</span>{" "}
          {expires ?? t("qa.card.no_expiry")}
        </span>
      </div>

      {rec.rationale ? (
        <p className="mt-2 rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-[12px] text-muted-foreground">
          <span className="font-medium text-foreground/80">{t("qa.card.rationale")}:</span>{" "}
          {rec.rationale}
        </p>
      ) : null}
    </div>
  );
}
