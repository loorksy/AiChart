"use client";

/**
 * Quant Agent feed (engineering plan §4) — a second, fully independent
 * recommendation engine. Every card carries an explicit "Quant Agent" badge
 * so it can never be mistaken for one of Lonora's own recommendations: this
 * output never passes through createCanonicalRecommendation /
 * applyRecommendationRevision, and it is symbol-scoped (a shared feed), not
 * tied to any broker account.
 */
import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Radar,
  RefreshCw,
} from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { EmptyState, PageHeader, Surface } from "@/components/foundation";
import { Button } from "@/components/squareui/button";
import { SkeletonBlock } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { QuantRecommendation } from "@/lib/quantAgent/types";

const PLAN_TYPE_LABEL: Record<string, string> = {
  immediate: "rec.plan_type.immediate",
  anticipatory: "rec.plan_type.anticipatory",
  conditional: "rec.plan_type.conditional",
};

function formatNumber(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return String(value);
}

function QuantRecommendationCard({ rec }: { rec: QuantRecommendation }) {
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

export function QuantAgentFeedClient() {
  const { t, dir } = useLocale();
  const [recs, setRecs] = useState<QuantRecommendation[] | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/quant-agent/recommendations", { cache: "no-store" });
      if (!res.ok) throw new Error("load failed");
      const json = (await res.json()) as {
        enabled?: boolean;
        recommendations?: QuantRecommendation[];
      };
      setEnabled(json.enabled !== false);
      setRecs(json.recommendations ?? []);
      setError(false);
    } catch {
      setError(true);
      setRecs((prev) => prev ?? []);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div dir={dir} className="mx-auto w-full max-w-6xl space-y-5">
      <PageHeader
        title={t("qa.page.title")}
        description={t("qa.page.subtitle")}
        icon={<Radar aria-hidden="true" />}
        actions={
          <Button
            variant="outline"
            size="xl"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void load().finally(() => setBusy(false));
            }}
          >
            <RefreshCw className={cn("h-3.5 w-3.5", busy && "animate-spin")} aria-hidden />
            {t("qa.page.refresh")}
          </Button>
        }
      />

      {!enabled ? (
        <Surface padding="none">
          <EmptyState icon={<Radar aria-hidden="true" />} title={t("qa.page.disabled")} />
        </Surface>
      ) : error ? (
        <Surface padding="none">
          <EmptyState
            announce
            tone="danger"
            icon={<AlertTriangle aria-hidden="true" />}
            title={t("qa.page.error")}
            action={
              <Button
                variant="outline"
                size="xl"
                onClick={() => {
                  setError(false);
                  void load();
                }}
              >
                <RefreshCw aria-hidden="true" className="h-3.5 w-3.5" />
                {t("qa.page.refresh")}
              </Button>
            }
          />
        </Surface>
      ) : recs == null ? (
        <div className="space-y-3" aria-busy="true">
          <span className="sr-only">{t("qa.page.title")}</span>
          {Array.from({ length: 3 }).map((_, i) => (
            <SkeletonBlock key={i} className="h-32" />
          ))}
        </div>
      ) : recs.length === 0 ? (
        <Surface padding="none">
          <EmptyState icon={<Radar aria-hidden="true" />} title={t("qa.page.empty")} />
        </Surface>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {recs.map((rec) => (
            <QuantRecommendationCard key={rec.id} rec={rec} />
          ))}
        </div>
      )}
    </div>
  );
}
