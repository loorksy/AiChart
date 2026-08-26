"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ImageOff, RefreshCw } from "lucide-react";
import { Button } from "@/components/squareui/button";
import { EmptyState, Surface } from "@/components/foundation";
import { useLocale } from "@/hooks/useLocale";
import {
  RecommendationFullReport,
  type FullReportRecommendation,
} from "@/components/recommendations/RecommendationFullReport";
import { OutcomeSummaryPanel } from "@/components/recommendations/OutcomeSummaryPanel";
import { RecommendationTimeline } from "@/components/recommendations/RecommendationTimeline";
import { ExecuteRecommendationButton } from "@/components/recommendations/ExecuteRecommendationButton";
import type { ActiveRecommendationView } from "@/app/api/recommendations/active/route";
import type { RecommendationTimelineEvent } from "@/lib/recommendations/timeline";
import type { TradeMetricsSummary } from "@/lib/recommendations/tradeMetricsSummary";
import type { TrackedRecommendation } from "@/lib/recommendations/types";

interface DetailPayload {
  rec: FullReportRecommendation;
  timeline: RecommendationTimelineEvent[];
  summary: TradeMetricsSummary | null;
}

/**
 * The standalone report page the tracked plan card links to. The tracked
 * projection always exists — now alongside its event TIMELINE and outcome
 * summary (both computed server-side from the same persisted record). When
 * the plan is still active, the enriched view (evidence, decision trace,
 * activation, lifecycle triggers) is merged in.
 */
async function loadRecommendation(id: string): Promise<DetailPayload | null> {
  const res = await fetch(`/api/recommendations/tracked/${id}`, { cache: "no-store" });
  if (!res.ok) return null;
  const json = (await res.json()) as {
    recommendation?: TrackedRecommendation;
    timeline?: RecommendationTimelineEvent[];
    summary?: TradeMetricsSummary;
  };
  const tracked = json.recommendation;
  if (!tracked) return null;
  const timeline = json.timeline ?? [];
  const summary = json.summary ?? null;
  try {
    const activeRes = await fetch("/api/recommendations/active", { cache: "no-store" });
    if (activeRes.ok) {
      const activeJson = (await activeRes.json()) as {
        recommendations?: ActiveRecommendationView[];
      };
      const enriched = activeJson.recommendations?.find((r) => String(r.id) === String(id));
      if (enriched) return { rec: enriched, timeline, summary };
    }
  } catch {
    /* history plans have no active enrichment — the tracked shape suffices */
  }
  return { rec: tracked, timeline, summary };
}

export default function RecommendationDetailsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { t, dir } = useLocale();
  const [payload, setPayload] = useState<DetailPayload | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [chartFailed, setChartFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const loaded = await loadRecommendation(id);
      if (alive) setPayload(loaded);
    })();
    return () => {
      alive = false;
    };
  }, [id]);

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const loaded = await loadRecommendation(id);
      if (loaded) setPayload(loaded);
    } finally {
      setBusy(false);
    }
  }, [id]);

  const rec = payload?.rec;

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

      {payload === undefined && (
        <p className="text-center text-sm text-muted-foreground">…</p>
      )}
      {payload === null && (
        <Surface padding="none">
          <EmptyState size="sm" title={t("rec.page.empty")} />
        </Surface>
      )}
      {payload && rec && (
        <div className="space-y-3">
          <RecommendationFullReport rec={rec} />

          {payload.summary ? <OutcomeSummaryPanel summary={payload.summary} /> : null}

          {payload.timeline.length > 0 ? (
            <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2">
              <p className="mb-2 text-[12px] font-semibold text-foreground">
                {t("rec.timeline.title")}
              </p>
              <RecommendationTimeline events={payload.timeline} />
            </div>
          ) : null}

          {/* The plan's chart snapshot: its levels and stored drawings over
              platform candles, rendered server-side. Hidden when the render
              is unavailable — a broken image says less than nothing. */}
          {!chartFailed ? (
            <div className="overflow-hidden rounded-lg border border-border/60">
              <p className="flex items-center gap-1.5 border-b border-border/60 bg-muted/20 px-3 py-2 text-[12px] font-semibold text-foreground">
                {t("rec.detail.chart")}
              </p>
              {/* eslint-disable-next-line @next/next/no-img-element -- runtime PNG from an authed API route; next/image adds nothing here */}
              <img
                src={`/api/recommendations/tracked/${id}/chart`}
                alt={t("rec.detail.chart")}
                className="block w-full bg-card"
                loading="lazy"
                onError={() => setChartFailed(true)}
              />
            </div>
          ) : (
            <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <ImageOff className="h-3.5 w-3.5 shrink-0" aria-hidden />
              {t("rec.detail.chart")}: —
            </p>
          )}

          <div className="flex gap-2">
            {/* Renders ONLY when the server says linked + executable now. */}
            <ExecuteRecommendationButton recommendationId={id} />
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
        </div>
      )}
    </div>
  );
}
