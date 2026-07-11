"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { RefreshCw } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { RecommendationTrackerCard } from "@/components/recommendations/RecommendationTrackerCard";
import type { TrackedRecommendation } from "@/lib/recommendations/types";

export default function RecommendationsPage() {
  const { t, dir } = useLocale();
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
    let alive = true;
    void (async () => {
      const res = await fetch("/api/recommendations/tracked", { cache: "no-store" });
      const json = res.ok
        ? ((await res.json()) as { recommendations?: TrackedRecommendation[] })
        : null;
      if (alive) setRecs(json?.recommendations ?? []);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const sweep = useCallback(async () => {
    setBusy(true);
    try {
      await fetch("/api/recommendations/tracked/sweep", { method: "POST" }).catch(() => {});
      await load();
    } finally {
      setBusy(false);
    }
  }, [load]);

  const active = (recs ?? []).filter((r) => r.outcome === "pending");
  const history = (recs ?? []).filter((r) => r.outcome !== "pending");

  return (
    <div dir={dir} className="mx-auto max-w-5xl p-4">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h1 className="text-lg font-bold text-foreground">{t("rec.page.title")}</h1>
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

      {recs && recs.length === 0 && (
        <p className="rounded-lg border border-border/60 bg-card p-6 text-center text-sm text-muted-foreground">
          {t("rec.page.empty")}
        </p>
      )}

      {active.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-2 text-sm font-semibold text-muted-foreground">
            {t("rec.page.active")} ({active.length})
          </h2>
          <div className="grid gap-3 md:grid-cols-2">
            {active.map((r) => (
              <Link key={r.id} href={`/recommendations/${r.id}`} className="block">
                <RecommendationTrackerCard rec={r} />
              </Link>
            ))}
          </div>
        </section>
      )}

      {history.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-muted-foreground">
            {t("rec.page.history")} ({history.length})
          </h2>
          <div className="grid gap-3 md:grid-cols-2">
            {history.map((r) => (
              <Link key={r.id} href={`/recommendations/${r.id}`} className="block">
                <RecommendationTrackerCard rec={r} />
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
