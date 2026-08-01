"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { Button } from "@/components/squareui/button";
import { EmptyState, Surface } from "@/components/foundation";
import { useLocale } from "@/hooks/useLocale";
import { RecommendationTrackerCard } from "@/components/recommendations/RecommendationTrackerCard";
import type { TrackedRecommendation } from "@/lib/recommendations/types";

export default function RecommendationDetailsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { t, dir } = useLocale();
  const [rec, setRec] = useState<TrackedRecommendation | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const res = await fetch(`/api/recommendations/tracked/${id}`, { cache: "no-store" });
      const json = res.ok
        ? ((await res.json()) as { recommendation?: TrackedRecommendation })
        : null;
      if (alive) setRec(json?.recommendation ?? null);
    })();
    return () => {
      alive = false;
    };
  }, [id]);

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/recommendations/tracked/${id}`, { cache: "no-store" });
      if (res.ok) {
        const json = (await res.json()) as { recommendation?: TrackedRecommendation };
        if (json.recommendation) setRec(json.recommendation);
      }
    } finally {
      setBusy(false);
    }
  }, [id]);

  return (
    <div dir={dir} className="mx-auto max-w-lg p-4">
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
          <RecommendationTrackerCard rec={rec} />
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
