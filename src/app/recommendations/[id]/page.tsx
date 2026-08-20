"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { Button } from "@/components/squareui/button";
import { EmptyState, Surface } from "@/components/foundation";
import { useLocale } from "@/hooks/useLocale";
import {
  RecommendationFullReport,
  type FullReportRecommendation,
} from "@/components/recommendations/RecommendationFullReport";
import type { ActiveRecommendationView } from "@/app/api/recommendations/active/route";
import type { TrackedRecommendation } from "@/lib/recommendations/types";

/**
 * The standalone report page the compact signal card links to. The tracked
 * projection always exists; when the plan is still active, the enriched view
 * (evidence, decision trace, activation, lifecycle triggers) is merged in.
 */
async function loadRecommendation(id: string): Promise<FullReportRecommendation | null> {
  const res = await fetch(`/api/recommendations/tracked/${id}`, { cache: "no-store" });
  if (!res.ok) return null;
  const json = (await res.json()) as { recommendation?: TrackedRecommendation };
  const tracked = json.recommendation;
  if (!tracked) return null;
  try {
    const activeRes = await fetch("/api/recommendations/active", { cache: "no-store" });
    if (activeRes.ok) {
      const activeJson = (await activeRes.json()) as {
        recommendations?: ActiveRecommendationView[];
      };
      const enriched = activeJson.recommendations?.find((r) => String(r.id) === String(id));
      if (enriched) return enriched;
    }
  } catch {
    /* history plans have no active enrichment — the tracked shape suffices */
  }
  return tracked;
}

export default function RecommendationDetailsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { t, dir } = useLocale();
  const [rec, setRec] = useState<FullReportRecommendation | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const loaded = await loadRecommendation(id);
      if (alive) setRec(loaded);
    })();
    return () => {
      alive = false;
    };
  }, [id]);

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const loaded = await loadRecommendation(id);
      if (loaded) setRec(loaded);
    } finally {
      setBusy(false);
    }
  }, [id]);

  return (
    <div dir={dir} className="mx-auto max-w-2xl p-4">
      <Link
        href="/recommendations"
        className="mb-4 inline-flex min-h-11 items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground focus-ring sm:min-h-0"
      >
        {/* Mirrors under RTL so "back" points the way the reader came from. */}
        <ArrowLeft className="h-3.5 w-3.5 rtl:rotate-180" aria-hidden />
        {t("rec.page.back")}
      </Link>

      {rec === undefined && (
        <p className="text-center text-sm text-muted-foreground">…</p>
      )}
      {rec === null && (
        <Surface padding="none">
          <EmptyState size="sm" title={t("rec.page.empty")} />
        </Surface>
      )}
      {rec && (
        <>
          <RecommendationFullReport rec={rec} />
          <div className="mt-3 flex gap-2">
            <Button
              variant="outline"
              size="xl"
              onClick={() => void refresh()}
              disabled={busy}
              className="flex-1"
            >
              <RefreshCw
                aria-hidden
                className={`h-3.5 w-3.5 ${busy ? "animate-spin motion-reduce:animate-none" : ""}`}
              />
              {t("rec.page.refresh")}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
