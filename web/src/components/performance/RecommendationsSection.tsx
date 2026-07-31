"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { RefreshCw } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { RecommendationTrackerCard } from "@/components/recommendations/RecommendationTrackerCard";
import { ActiveRecommendationsPanel } from "@/components/recommendations/ActiveRecommendationsPanel";
import { SkeletonBlock } from "@/components/ui/skeleton";
import type { TrackedRecommendation } from "@/lib/recommendations/types";

/** Recommendations block of the unified performance page (was /recommendations). */
export function RecommendationsSection() {
  const { t } = useLocale();
  const [recs, setRecs] = useState<TrackedRecommendation[] | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/recommendations/tracked", { cache: "no-store" });
    if (!res.ok) {
      setRecs([]);
      return;
    }
    const json = (await res.json()) as { recommendations?: TrackedRecommendation[] };
    setRecs(json.recommendations ?? []);
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
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-foreground">{t("rec.page.title")}</h2>
        <button
          type="button"
          onClick={() => void sweep()}
          disabled={busy}
          className="flex items-center gap-1.5 rounded-lg border border-border/60 bg-background px-3 py-1.5 text-xs font-semibold hover:bg-muted disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} />
          {t("rec.page.refresh")}
        </button>
      </div>

      {!recs && (
        <div className="grid gap-3 md:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <SkeletonBlock key={i} className="h-40" />
          ))}
        </div>
      )}

      {recs && recs.length === 0 && (
        <p className="rounded-lg border border-border/60 bg-card p-6 text-center text-sm text-muted-foreground">
          {t("rec.page.empty")}
        </p>
      )}

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
              <Link key={r.id} href={`/recommendations/${r.id}`} className="block">
                <RecommendationTrackerCard rec={r} />
              </Link>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
