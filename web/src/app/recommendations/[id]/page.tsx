"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, RefreshCw } from "lucide-react";
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
        className="mb-4 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        {t("rec.page.back")}
      </Link>

      {rec === undefined && (
        <p className="text-center text-sm text-muted-foreground">…</p>
      )}
      {rec === null && (
        <p className="rounded-lg border border-border/60 bg-card p-6 text-center text-sm text-muted-foreground">
          {t("rec.page.empty")}
        </p>
      )}
      {rec && (
        <>
          <RecommendationTrackerCard rec={rec} />
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => void refresh()}
              disabled={busy}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-border/60 bg-background px-3 py-2 text-xs font-semibold hover:bg-muted disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} />
              {t("rec.page.refresh")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
