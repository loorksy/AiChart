"use client";

/**
 * `/quant-agent/analysis` — run one Quant Agent LLM analysis and read the
 * report, or open a saved one with `?id=`.
 *
 * Ported from QuantDinger (https://github.com/OpenByteInc/QuantDinger),
 * Copyright Open Byte Inc., licensed under the Apache License, Version 2.0
 * — `src/views/ai-asset-analysis/index.vue` (the analysis shell) and the
 * loading/error/empty states of
 * `src/views/ai-analysis/components/FastAnalysisReport.vue:3-76`.
 *
 * What changed:
 *  - Upstream's shell is a desktop workspace whose toolbar, watchlist and
 *    hero all sit behind `v-if="false"`; this is the mobile-first surface the
 *    screenshots actually show — a symbol/timeframe row, one Analyze button,
 *    and the report below it.
 *  - Upstream's loading state animates a FAKE percentage
 *    (`FastAnalysisReport.vue:985-1003` increments a counter on a 100 ms
 *    timer and calls it progress). The four pipeline steps are real and are
 *    kept; the invented number is not. What is shown instead is the elapsed
 *    time, which is measured.
 *  - The page is a client component rather than the usual
 *    "server page renders one client component" pair, because it owns query
 *    params, polling and run state; auth, subscription gating and the app
 *    shell still come from `quant-agent/layout.tsx` unchanged.
 */
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AlertTriangle, History, Play, Radar, Search } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { useLivePrice } from "@/hooks/useLivePrice";
import { EmptyState, PageHeader, Surface } from "@/components/foundation";
import { Button, buttonVariants } from "@/components/squareui/button";
import { Input } from "@/components/squareui/input";
import { Label } from "@/components/squareui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/squareui/select";
import { SkeletonBlock } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { QuantAnalysisRecord } from "@/lib/quantAgent/types";
import { AccuracyStrip } from "@/components/quantAgent/analysis/AccuracyStrip";
import { QuantAnalysisReport, formatAnalysisPrice } from "@/components/quantAgent/analysis/QuantAnalysisReport";

/** Same cadence list the monitor sheet offers — an analysis re-reads the same feeds. */
const ANALYSIS_INTERVALS = ["5m", "15m", "30m", "1h", "4h", "1d"] as const;
const DEFAULT_INTERVAL = "1h";

/**
 * Upstream's four steps, in order. Which one is "current" is an elapsed-time
 * ESTIMATE, not a server signal: `POST /api/quant-agent/analysis` is a single
 * blocking call with no progress channel. The estimate only moves a caret —
 * no percentage is claimed, because none is measured.
 */
const STEP_KEYS = [
  "qa.analysis.step1",
  "qa.analysis.step2",
  "qa.analysis.step3",
  "qa.analysis.step4",
] as const;
const STEP_BOUNDARIES_MS = [3_000, 8_000, 25_000];

function currentStepIndex(elapsedMs: number): number {
  for (let index = 0; index < STEP_BOUNDARIES_MS.length; index += 1) {
    if (elapsedMs < STEP_BOUNDARIES_MS[index]) return index;
  }
  return STEP_KEYS.length - 1;
}

function formatElapsed(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

function AnalysisPageBody() {
  const { t, dir, locale } = useLocale();
  const searchParams = useSearchParams();
  const idParam = searchParams.get("id");
  const symbolParam = searchParams.get("symbol");
  const intervalParam = searchParams.get("interval");

  const [symbol, setSymbol] = useState((symbolParam ?? "").toUpperCase());
  const [interval, setIntervalValue] = useState(intervalParam ?? DEFAULT_INTERVAL);
  const [analysis, setAnalysis] = useState<QuantAnalysisRecord | null>(null);
  const [running, setRunning] = useState(false);
  const [loadingStored, setLoadingStored] = useState(Boolean(idParam));
  const [error, setError] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const startedAtRef = useRef(0);

  // A saved analysis opened from the chat card or the history list.
  useEffect(() => {
    if (!idParam) {
      setLoadingStored(false);
      return;
    }
    let alive = true;
    setLoadingStored(true);
    setError(null);
    void (async () => {
      try {
        const res = await fetch(`/api/quant-agent/analysis/${encodeURIComponent(idParam)}`, {
          cache: "no-store",
        });
        if (!alive) return;
        if (res.status === 404) {
          setError(t("qa.analysis.error.not_found"));
          return;
        }
        if (!res.ok) throw new Error("load failed");
        const json = (await res.json()) as { analysis?: QuantAnalysisRecord };
        if (!alive || !json.analysis) return;
        setAnalysis(json.analysis);
        setSymbol(json.analysis.symbol.toUpperCase());
        setIntervalValue(json.analysis.interval);
      } catch {
        if (alive) setError(t("qa.analysis.error.generic"));
      } finally {
        if (alive) setLoadingStored(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [idParam, t]);

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setElapsedMs(Date.now() - startedAtRef.current), 1000);
    return () => clearInterval(timer);
  }, [running]);

  const trimmedSymbol = symbol.trim();
  const live = useLivePrice(trimmedSymbol, trimmedSymbol.length >= 3 && !running);
  const livePrice = live.connected && live.price > 0 ? live.price : null;

  // The only percentage this page shows: live quote against the price the
  // analysis was actually run at. Both sides are measured; when either is
  // missing the slot reads as absent rather than as zero.
  const changePct =
    livePrice != null && analysis?.currentPrice != null && analysis.currentPrice !== 0
      ? ((livePrice - analysis.currentPrice) / analysis.currentPrice) * 100
      : null;

  const runAnalysis = useCallback(async () => {
    const target = symbol.trim().toUpperCase();
    if (!target) return;
    setRunning(true);
    setError(null);
    startedAtRef.current = Date.now();
    setElapsedMs(0);
    try {
      const res = await fetch("/api/quant-agent/analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // `locale` is what makes the model answer in the reader's language —
        // the prompt's language instruction is keyed off it. Omitting it made
        // every run fall back to DEFAULT_LOCALE, so an English reader got an
        // Arabic report.
        body: JSON.stringify({ symbol: target, interval, locale }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        analysis?: QuantAnalysisRecord;
        error?: string;
      };
      if (res.status === 429) {
        setError(json.error ?? t("qa.analysis.error.in_progress"));
        return;
      }
      if (!res.ok || !json.analysis) {
        setError(json.error ?? t("qa.analysis.error.generic"));
        return;
      }
      setAnalysis(json.analysis);
    } catch {
      setError(t("qa.analysis.error.generic"));
    } finally {
      setRunning(false);
    }
  }, [interval, locale, symbol, t]);

  const stepIndex = currentStepIndex(elapsedMs);

  return (
    <div dir={dir} className="mx-auto w-full max-w-6xl space-y-5">
      <PageHeader
        title={t("qa.analysis.title")}
        description={t("qa.analysis.subtitle")}
        icon={<Radar aria-hidden="true" />}
        actions={
          // A real navigation, so it stays an anchor — routing `Button`
          // through `render` would strip link semantics for `role="button"`.
          <Link
            href="/quant-agent/analysis/history"
            className={cn(buttonVariants({ variant: "outline", size: "xl" }), "gap-2")}
          >
            <History className="h-3.5 w-3.5" aria-hidden="true" />
            {t("qa.analysis.open_history")}
          </Link>
        }
      />

      {/* symbol / timeframe / run */}
      <Surface padding="sm" className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Label htmlFor="qa-analysis-symbol">{t("qa.analysis.field.symbol")}</Label>
            <Input
              id="qa-analysis-symbol"
              dir="ltr"
              value={symbol}
              placeholder="XAUUSD"
              maxLength={32}
              onChange={(event) => setSymbol(event.target.value.toUpperCase())}
            />
          </div>
          <div className="flex flex-col gap-1.5 sm:w-40">
            <Label htmlFor="qa-analysis-interval">{t("qa.analysis.field.interval")}</Label>
            <Select value={interval} onValueChange={(value) => value && setIntervalValue(value)}>
              <SelectTrigger id="qa-analysis-interval" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ANALYSIS_INTERVALS.map((option) => (
                  <SelectItem key={option} value={option}>
                    <span dir="ltr">{option}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            size="xl"
            className="sm:w-auto"
            disabled={running || trimmedSymbol.length === 0}
            onClick={() => void runAnalysis()}
          >
            <Play className="h-3.5 w-3.5 rtl:-scale-x-100" aria-hidden="true" />
            {running ? t("qa.analysis.analyzing") : analysis ? t("qa.analysis.rerun") : t("qa.analysis.run")}
          </Button>
        </div>

        {/* symbol · market · interval · live price · change */}
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 border-t border-border pt-3 sm:grid-cols-4">
          <div className="min-w-0">
            <dt className="text-[10px] uppercase tracking-[0.03em] text-muted-foreground">
              {t("qa.analysis.field.symbol")}
            </dt>
            <dd dir="ltr" className="truncate font-mono text-sm font-semibold text-foreground">
              {trimmedSymbol || "—"}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-[10px] uppercase tracking-[0.03em] text-muted-foreground">
              {t("qa.analysis.field.market")}
            </dt>
            <dd className="truncate text-sm text-foreground">
              {t("qa.analysis.market.forex")}
              <span dir="ltr" className="ms-1 font-mono text-[11px] text-muted-foreground">
                {interval}
              </span>
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-[10px] uppercase tracking-[0.03em] text-muted-foreground">
              {t("qa.analysis.price.live")}
            </dt>
            <dd dir="ltr" className="truncate font-mono text-sm font-semibold text-foreground">
              {formatAnalysisPrice(livePrice)}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-[10px] uppercase tracking-[0.03em] text-muted-foreground">
              {t("qa.analysis.price.change_since")}
            </dt>
            <dd
              dir="ltr"
              className={cn(
                "truncate font-mono text-sm font-semibold",
                changePct == null ? "text-foreground" : changePct >= 0 ? "text-buy" : "text-sell",
              )}
            >
              {changePct == null ? "—" : `${changePct >= 0 ? "+" : ""}${changePct.toFixed(2)}%`}
            </dd>
          </div>
        </dl>

        {livePrice == null ? (
          <p className="text-[11px] text-muted-foreground">{t("qa.analysis.price.needs_link")}</p>
        ) : null}
      </Surface>

      {/*
        How often this engine has actually been right, per confidence bucket.
        Above the report on purpose: it is the frame the reader should have
        BEFORE reading a fresh verdict, not a footnote after it. It renders
        itself away when the fetch fails, and says "not enough history yet"
        rather than showing a hit rate built from three rows.
      */}
      <AccuracyStrip />

      {error ? (
        <Surface padding="none">
          <EmptyState
            announce
            tone="danger"
            icon={<AlertTriangle aria-hidden="true" />}
            title={t("qa.analysis.error.title")}
            description={error}
            action={
              <Button variant="outline" size="xl" disabled={running} onClick={() => void runAnalysis()}>
                {t("qa.analysis.retry")}
              </Button>
            }
          />
        </Surface>
      ) : null}

      {running ? (
        <Surface padding="sm" aria-busy="true" className="space-y-2">
          <p className="text-sm font-semibold text-foreground">{t("qa.analysis.analyzing")}</p>
          <p className="text-[12px] text-muted-foreground">{t("qa.analysis.please_wait")}</p>
          <ol className="space-y-1.5 pt-1">
            {STEP_KEYS.map((key, index) => (
              <li key={key} className="flex items-center gap-2 text-[12px]">
                <span
                  className={cn(
                    "h-1.5 w-1.5 shrink-0 rounded-full",
                    index < stepIndex ? "bg-success" : index === stepIndex ? "animate-pulse bg-info" : "bg-border",
                  )}
                  aria-hidden="true"
                />
                <span className={index <= stepIndex ? "text-foreground" : "text-muted-foreground"}>{t(key)}</span>
              </li>
            ))}
          </ol>
          <p className="font-mono text-[11px] text-muted-foreground">
            {t("qa.analysis.elapsed", { value: formatElapsed(elapsedMs) })}
          </p>
        </Surface>
      ) : loadingStored ? (
        <div className="space-y-3" aria-busy="true">
          <span className="sr-only">{t("qa.analysis.history.loading")}</span>
          <SkeletonBlock className="h-40" />
          <SkeletonBlock className="h-24" />
        </div>
      ) : analysis ? (
        <QuantAnalysisReport analysis={analysis} />
      ) : !error ? (
        <Surface padding="none">
          <EmptyState
            icon={<Search aria-hidden="true" />}
            title={t("qa.analysis.empty.title")}
            description={t("qa.analysis.empty.description")}
          />
        </Surface>
      ) : null}
    </div>
  );
}

function AnalysisPageFallback() {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-5" aria-busy="true">
      <SkeletonBlock className="h-16" />
      <SkeletonBlock className="h-32" />
    </div>
  );
}

export default function QuantAgentAnalysisPage() {
  // `useSearchParams` needs a Suspense boundary above it; the page itself is
  // the client component, so the boundary lives here.
  return (
    <Suspense fallback={<AnalysisPageFallback />}>
      <AnalysisPageBody />
    </Suspense>
  );
}
