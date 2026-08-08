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
import { AlertTriangle, Radar, RefreshCw } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { EmptyState, PageHeader, Surface } from "@/components/foundation";
import { Button } from "@/components/squareui/button";
import { SkeletonBlock } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { QuantRecommendation } from "@/lib/quantAgent/types";
import { QuantRecommendationCard } from "./QuantRecommendationCard";

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
