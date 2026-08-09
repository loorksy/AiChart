"use client";

/**
 * Historical hit rate per confidence bucket — "when this engine said it was
 * 80% sure, how often was it right?"
 *
 * Ported from QuantDinger (https://github.com/OpenByteInc/QuantDinger),
 * Copyright Open Byte Inc., licensed under the Apache License, Version 2.0
 * — `src/views/ai-analysis/components/FastAnalysisReport.vue`'s historical
 * accuracy block, over `analysis_memory.get_confidence_accuracy_by_bucket`.
 *
 * What changed, and why:
 *  - IT REFUSES TO SHOW A NUMBER IT HAS NOT EARNED. Upstream renders whatever
 *    the aggregate returns. A bucket needs five validated analyses before its
 *    hit rate is reported at all (upstream's own floor, applied here to the
 *    display too), and with no reportable bucket the strip says "not enough
 *    history yet" and shows how far off it is. Three-out-of-three is not
 *    "100% accurate".
 *  - NO COLOUR-CODED VERDICT. Upstream tints the percentage green/amber/red on
 *    invented thresholds. There is no defensible cut-off between a "good" and
 *    a "bad" hit rate for a mixed BUY/SELL/HOLD population, so the numbers are
 *    rendered plainly and the reader is left to judge. The bar is scale, not
 *    praise.
 *  - The outcome rule is stated in the footnote, because a hit rate is
 *    meaningless without it: a call is scored 7 days later, BUY right above
 *    +2%, SELL right below -2%, HOLD right within ±5%.
 */
import { useEffect, useState } from "react";
import { Target } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { Surface } from "@/components/foundation";
import { SkeletonBlock } from "@/components/ui/skeleton";
import type { QuantAnalysisAccuracySummary } from "@/lib/quantAgent/analysisStore";

interface AccuracyResponse {
  accuracy?: QuantAnalysisAccuracySummary;
  windowDays?: number;
}

/**
 * The bucket edge is exclusive, so 60..70 reads "60–69". The top bucket ends
 * at 101 internally (a confidence of 100 has to land somewhere) and reads
 * "90–100".
 */
function bucketLabel(low: number, high: number): string {
  return `${low}–${Math.min(100, high - 1)}%`;
}

/**
 * Deliberately NOT scoped to the symbol on screen. Calibration is a property
 * of the engine, not of one pair, and a per-symbol split would put every
 * bucket back under the five-sample floor on all but the busiest account —
 * which would mean a strip that never says anything.
 */
export function AccuracyStrip() {
  const { t, dir } = useLocale();
  const [summary, setSummary] = useState<QuantAnalysisAccuracySummary | null>(null);
  const [loading, setLoading] = useState(true);
  // A failed fetch renders nothing at all. This strip is context, never the
  // reason the reader came here, and an error box for it would be noise.
  const [failed, setFailed] = useState(false);

  // Runs once on mount; `loading` already starts true and `failed` false, so
  // there is nothing to reset synchronously here.
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch("/api/quant-agent/analysis/accuracy", { cache: "no-store" });
        if (!alive) return;
        if (!res.ok) throw new Error("accuracy load failed");
        const json = (await res.json()) as AccuracyResponse;
        if (!alive) return;
        setSummary(json.accuracy ?? null);
      } catch {
        if (alive) setFailed(true);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (failed) return null;

  if (loading) {
    return (
      <div aria-busy="true">
        <span className="sr-only">{t("qa.analysis.history.loading")}</span>
        <SkeletonBlock className="h-20" />
      </div>
    );
  }

  if (!summary) return null;

  const hasBuckets = summary.buckets.length > 0;

  return (
    <Surface padding="sm">
      <div dir={dir} className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <p className="inline-flex items-center gap-1.5 text-sm font-semibold text-foreground">
            <Target className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
            {t("qa.analysis.accuracy.title")}
          </p>
          <span className="ms-auto font-mono text-[11px] text-muted-foreground" dir="ltr">
            {t("qa.analysis.accuracy.validated", { count: String(summary.validatedCount) })}
          </span>
        </div>

        {hasBuckets ? (
          <>
            <p className="text-[12px] text-muted-foreground">
              {t("qa.analysis.accuracy.subtitle")}
            </p>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3 lg:grid-cols-5">
              {summary.buckets.map((bucket) => (
                <div key={bucket.key} className="min-w-0">
                  <dt
                    dir="ltr"
                    className="font-mono text-[10px] uppercase tracking-[0.03em] text-muted-foreground"
                  >
                    {bucketLabel(bucket.low, bucket.high)}
                  </dt>
                  <dd className="font-mono text-sm font-semibold text-foreground">
                    {Math.round(bucket.hitRate * 100)}%
                  </dd>
                  {/* Scale, not judgement — see the header note on colour. */}
                  <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-chart-2"
                      style={{ width: `${Math.round(bucket.hitRate * 100)}%` }}
                    />
                  </div>
                  <p className="mt-0.5 font-mono text-[10px] text-muted-foreground" dir="ltr">
                    {t("qa.analysis.accuracy.samples", { count: String(bucket.samples) })}
                  </p>
                </div>
              ))}
            </dl>
          </>
        ) : (
          <p className="text-[12px] text-muted-foreground">
            {t("qa.analysis.accuracy.not_enough")}
          </p>
        )}

        <p className="border-t border-border pt-2 text-[11px] text-muted-foreground">
          {t("qa.analysis.accuracy.rule")}
        </p>
      </div>
    </Surface>
  );
}
