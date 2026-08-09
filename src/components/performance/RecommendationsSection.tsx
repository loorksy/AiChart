"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ListChecks, RefreshCw } from "lucide-react";
import { Button } from "@/components/squareui/button";
import { useLocale } from "@/hooks/useLocale";
import { RecommendationTrackerCard } from "@/components/recommendations/RecommendationTrackerCard";
import { ActiveRecommendationsPanel } from "@/components/recommendations/ActiveRecommendationsPanel";
import { EmptyState, SectionHeader, Surface } from "@/components/foundation";
import { SkeletonBlock } from "@/components/ui/skeleton";
import type { TrackedRecommendation } from "@/lib/recommendations/types";

/** Recommendations block of the unified performance page (was /recommendations). */
export function RecommendationsSection() {
  const { t } = useLocale();
  const [recs, setRecs] = useState<TrackedRecommendation[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    // A failed request used to be written in as an empty list, so a server
    // error was indistinguishable from "you have no recommendations".
    try {
      const res = await fetch("/api/recommendations/tracked", { cache: "no-store" });
      if (!res.ok) {
        setFailed(true);
        return;
      }
      const json = (await res.json()) as { recommendations?: TrackedRecommendation[] };
      setRecs(json.recommendations ?? []);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const sweep = useCallback(async () => {
    setBusy(true);
    try {
      await load();
    } finally {
      setBusy(false);
    }
  }, [load]);

  const active = (recs ?? []).filter((r) => r.outcome === "pending");
  const history = (recs ?? []).filter((r) => r.outcome !== "pending");

  return (
    <section id="recommendations" className="scroll-mt-24 space-y-3">
      <SectionHeader
        title={t("rec.page.title")}
        actions={
          <Button
            variant="outline"
            size="sm"
            className="min-h-11 sm:min-h-8"
            onClick={() => void sweep()}
            disabled={busy}
          >
            <RefreshCw
              aria-hidden="true"
              className={`h-3.5 w-3.5 ${busy ? "animate-spin motion-reduce:animate-none" : ""}`}
            />
            {t("rec.page.refresh")}
          </Button>
        }
      />

      {failed ? (
        <Surface padding="none">
          <EmptyState
            announce
            tone="danger"
            size="sm"
            icon={<AlertTriangle aria-hidden="true" />}
            title={t("agent.error")}
            description={t("agent.fault.retryable")}
            action={
              <Button
                variant="outline"
                size="xl"
                onClick={() => void sweep()}
                disabled={busy}
              >
                <RefreshCw
                  aria-hidden="true"
                  className={`h-3.5 w-3.5 ${busy ? "animate-spin motion-reduce:animate-none" : ""}`}
                />
                {t("rec.page.refresh")}
              </Button>
            }
          />
        </Surface>
      ) : !recs ? (
        <div className="grid gap-3 md:grid-cols-2" aria-busy="true">
          {Array.from({ length: 2 }).map((_, i) => (
            <SkeletonBlock key={i} className="h-40" />
          ))}
        </div>
      ) : recs.length === 0 ? (
        <Surface padding="none">
          <EmptyState
            size="sm"
            icon={<ListChecks aria-hidden="true" />}
            title={t("rec.page.empty")}
          />
        </Surface>
      ) : null}

      {/* Active plans render with their full explainable state (revision,
          evidence dimensions, decision trace, triggers). */}
      {active.length > 0 && (
        <div className="mb-4">
          <ActiveRecommendationsPanel />
        </div>
      )}

      {history.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold text-muted-foreground">
            {t("rec.page.history")} ({history.length})
          </h3>
          <div className="grid gap-3 md:grid-cols-2">
            {history.map((r) => (
              <Link
                key={r.id}
                href={`/recommendations/${r.id}`}
                className="block rounded-[var(--radius-lg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <RecommendationTrackerCard rec={r} />
              </Link>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
