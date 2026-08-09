"use client";

/**
 * The full Quant Agent analysis report body — the surface a stored
 * `QuantAnalysisRecord` renders into on `/quant-agent/analysis`.
 *
 * Ported from QuantDinger (https://github.com/OpenByteInc/QuantDinger),
 * Copyright Open Byte Inc., licensed under the Apache License, Version 2.0
 * — `src/views/ai-analysis/components/FastAnalysisReport.vue`. Section ORDER
 * is upstream's: decision hero (+ multi-timeframe consensus strip), price
 * strip, multi-horizon outlook, dimension scores, detailed analysis, key
 * reasons & risks. `formatPrice`'s magnitude ladder and the
 * `getScoreColor` / `_trend_strength` thresholds are copied exactly.
 *
 * What changed, and why:
 *  - Ant-Design-Vue is not in this tree, so every widget is plain markup on
 *    DESIGN.md tokens. Upstream's per-section hexes become semantic tokens:
 *    bullish/bearish read `buy`/`sell` (they ARE a direction), a neutral
 *    verdict reads muted rather than upstream's amber, and the four score
 *    bars use `--chart-2..5`, whose values already are upstream's
 *    blue/green/amber/red — `buy`/`sell` are reserved for direction.
 *  - Upstream's `$`-prefixes every price for every market
 *    (`index.vue:1834`); this platform is forex-only, where a quote is not
 *    dollars, so the prefix is dropped rather than made wrong.
 *  - Upstream defaults every missing number to 50 (`scores?.technical || 50`,
 *    `confidence || 50`). Nothing here defaults: an absent component renders
 *    an em dash and is named in the data-quality notice. That is the whole
 *    point of carrying `dataQuality.missing` through the wire.
 *  - Upstream's crypto-market-structure block, indicator matrix,
 *    quant-parameter table and helpful/not-helpful feedback row are not
 *    rendered: nothing on this platform produces those inputs yet, and a
 *    section that can only show placeholders is worse than no section.
 *    Upstream's historical-accuracy strip WAS in that list until Wave 2 gave
 *    it real inputs; it now lives in its own component,
 *    `AccuracyStrip.tsx`, rendered by the analysis page above this report
 *    rather than inside it — a hit rate is the frame you read a verdict
 *    through, not a footnote to one.
 *  - `neutralizeDecisionText` (upstream's BUY/SELL/HOLD word-scrub over model
 *    prose) is not ported — our prompt already asks for outlook wording, and
 *    a regex that rewrites the model's own sentences is a silent edit of
 *    evidence.
 */
import { useId, useState } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  CalendarClock,
  ChevronDown,
  FileText,
  Gauge,
  HeartPulse,
  Landmark,
  Lightbulb,
  LineChart,
  Minus,
  ShieldAlert,
  TriangleAlert,
} from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { Surface } from "@/components/foundation";
import { cn } from "@/lib/utils";
import type {
  QuantAnalysisDecision,
  QuantAnalysisOutlookLeg,
  QuantAnalysisRecord,
} from "@/lib/quantAgent/types";
import { ConfidenceGauge } from "./ConfidenceGauge";

/* ------------------------------------------------------------------ *
 * Shared formatting + tone helpers. Exported because the chat card
 * renders the same numbers and must not drift from the page.
 * ------------------------------------------------------------------ */

export type QuantAnalysisTone = "buy" | "sell" | "neutral";

/**
 * QuantDinger `FastAnalysisReport.vue:826-835`, same magnitude ladder. The
 * null glyph is AiChart's em dash (`formatNumber` in `QuantRecommendationCard`)
 * rather than upstream's `--`, and the ladder tests `Math.abs` so a negative
 * never falls through to the thousands branch.
 */
export function formatAnalysisPrice(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const num = Number(value);
  const magnitude = Math.abs(num);
  if (magnitude < 1) return num.toFixed(6);
  if (magnitude < 100) return num.toFixed(4);
  if (magnitude < 10_000) return num.toFixed(2);
  // Digits stay Latin on purpose — DESIGN.md §3: numbers never reshape in RTL.
  return num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** `parseFloat(v).toFixed(d)` with an em dash for the absent case. */
export function formatAnalysisNumber(value: number | null | undefined, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return Number(value).toFixed(digits);
}

/** A 0–100 self-assessed score, or an em dash when the component had no source. */
export function formatAnalysisScore(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return String(Math.round(value));
}

export function decisionTone(decision: QuantAnalysisDecision | null): QuantAnalysisTone {
  if (decision === "BUY") return "buy";
  if (decision === "SELL") return "sell";
  return "neutral";
}

/** HOLD is deliberately NOT amber here — DESIGN.md keeps warning for pending/conditional. */
export const DECISION_TEXT_CLASS: Record<QuantAnalysisTone, string> = {
  buy: "text-buy",
  sell: "text-sell",
  neutral: "text-muted-foreground",
};

export const DECISION_BAR_CLASS: Record<QuantAnalysisTone, string> = {
  buy: "bg-buy",
  sell: "bg-sell",
  neutral: "bg-border",
};

export function DecisionIcon({ tone, className }: { tone: QuantAnalysisTone; className?: string }) {
  if (tone === "buy") return <ArrowUpRight className={className} aria-hidden="true" />;
  if (tone === "sell") return <ArrowDownRight className={className} aria-hidden="true" />;
  return <Minus className={className} aria-hidden="true" />;
}

/**
 * Upstream renders the verdict as an OUTLOOK word, not as BUY/SELL/HOLD
 * (`formatDecisionLabel`, `:856-861`) — the engine is advisory, and the label
 * is what says so. Kept.
 */
export function decisionLabelKey(decision: QuantAnalysisDecision): string {
  return `qa.analysis.decision.${decision}`;
}

/** QuantDinger `getScoreColor` (`:902-907`) — same four bands, our chart tokens. */
function scoreBarClass(score: number | null): string {
  if (score == null || !Number.isFinite(score)) return "bg-border";
  if (score >= 70) return "bg-chart-3";
  if (score >= 50) return "bg-chart-2";
  if (score >= 30) return "bg-chart-4";
  return "bg-chart-5";
}

/** `bullish`/`bearish`/`neutral` from quant-agent's `OUTLOOK_LABELS`. */
function outlookTone(label: string): QuantAnalysisTone {
  if (label === "bullish") return "buy";
  if (label === "bearish") return "sell";
  return "neutral";
}

/**
 * `dataQuality.missing` carries machine codes from two sources — web's own
 * "this platform has no such feed" list and quant-agent's per-component and
 * per-indicator names. Unknown codes render raw rather than being hidden: an
 * untranslated code is still true, a dropped one is not.
 */
function missingLabel(translate: (key: string) => string, code: string): string {
  const key = `qa.analysis.missing.${code}`;
  const label = translate(key);
  return label === key ? code : label;
}

/* ------------------------------------------------------------------ *
 * Section shell — upstream's `.report-section` with its clickable header
 * and 90°-rotating caret (`:1176-1182`), all six default-open (`:518-525`).
 * ------------------------------------------------------------------ */

function ReportSection({
  title,
  icon,
  children,
  defaultOpen = true,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const panelId = useId();
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Surface padding="none">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex min-h-11 w-full items-center gap-2 rounded-[var(--radius-lg)] px-3 py-2 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="text-muted-foreground [&_svg]:h-4 [&_svg]:w-4">{icon}</span>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{title}</span>
        <ChevronDown
          className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", !open && "ltr:-rotate-90 rtl:rotate-90")}
          aria-hidden="true"
        />
      </button>
      {open ? (
        <div id={panelId} className="border-t border-border px-3 py-3">
          {children}
        </div>
      ) : null}
    </Surface>
  );
}

/* ------------------------------------------------------------------ *
 * The report
 * ------------------------------------------------------------------ */

export interface QuantAnalysisReportProps {
  analysis: QuantAnalysisRecord;
  className?: string;
}

export function QuantAnalysisReport({ analysis, className }: QuantAnalysisReportProps) {
  const { t, dir, locale } = useLocale();
  const tone = decisionTone(analysis.decision);
  const isHold = analysis.decision === "HOLD" || analysis.decision == null;

  const runAt = (() => {
    const parsed = new Date(analysis.createdAt);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toLocaleString(locale === "ar" ? "ar" : "en", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  })();

  if (analysis.status === "failed") {
    return (
      <div dir={dir} className={cn("space-y-3", className)}>
        <Surface padding="sm" className="border-destructive/30">
          <div className="flex items-start gap-2">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-foreground">{t("qa.analysis.error.title")}</p>
              <p className="mt-1 break-words text-[12px] text-muted-foreground">
                {analysis.error ?? t("qa.analysis.error.generic")}
              </p>
              {runAt ? (
                <p className="mt-2 text-[11px] text-muted-foreground">
                  {t("qa.analysis.created_at")}: <span className="font-mono">{runAt}</span>
                </p>
              ) : null}
            </div>
          </div>
        </Surface>
        <DataQualityNotice analysis={analysis} />
      </div>
    );
  }

  const outlookRows: { key: string; labelKey: string; leg: QuantAnalysisOutlookLeg }[] = analysis.outlook
    ? [
        { key: "h24", labelKey: "qa.analysis.outlook.h24", leg: analysis.outlook.h24 },
        { key: "d3", labelKey: "qa.analysis.outlook.d3", leg: analysis.outlook.d3 },
        { key: "w1", labelKey: "qa.analysis.outlook.w1", leg: analysis.outlook.w1 },
        { key: "m1", labelKey: "qa.analysis.outlook.m1", leg: analysis.outlook.m1 },
      ]
    : [];

  const detailBlocks = analysis.detail
    ? (
        [
          { key: "technical", icon: <LineChart aria-hidden="true" />, text: analysis.detail.technical, score: analysis.scores.technical },
          { key: "fundamental", icon: <Landmark aria-hidden="true" />, text: analysis.detail.fundamental, score: analysis.scores.fundamental },
          { key: "sentiment", icon: <HeartPulse aria-hidden="true" />, text: analysis.detail.sentiment, score: analysis.scores.sentiment },
        ] as const
      ).filter((block) => block.text.trim().length > 0)
    : [];

  return (
    <div dir={dir} className={cn("space-y-3", className)} data-testid="quant-analysis-report">
      {/* 1 — decision hero + multi-period consensus strip */}
      <Surface padding="none" className="overflow-hidden">
        <div className={cn("h-1", DECISION_BAR_CLASS[tone])} aria-hidden="true" />
        <div className="p-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className={cn("inline-flex items-center gap-1.5 text-2xl font-extrabold", DECISION_TEXT_CLASS[tone])}>
              <DecisionIcon tone={tone} className="h-6 w-6" />
              {analysis.decision ? t(decisionLabelKey(analysis.decision)) : "—"}
            </span>
            <ConfidenceGauge value={analysis.confidence} label={t("qa.analysis.confidence")} size={80} />
          </div>

          {analysis.summary ? (
            <p className="mt-3 whitespace-pre-line break-words border-t border-border pt-3 text-sm leading-relaxed text-muted-foreground">
              {analysis.summary}
            </p>
          ) : null}

          {analysis.consensus ? (
            <div className="mt-3 rounded-lg border border-border/60 bg-muted/20 px-3 py-2">
              <p className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-foreground">
                <BarChart3 className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                {t("qa.analysis.consensus.title")}
              </p>
              <dl className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-4">
                <div className="min-w-0">
                  <dt className="text-[10px] uppercase tracking-[0.03em] text-muted-foreground">
                    {t("qa.analysis.consensus.decision")}
                  </dt>
                  <dd className={cn("text-[12px] font-semibold", DECISION_TEXT_CLASS[decisionTone(analysis.consensus.decision)])}>
                    {t(decisionLabelKey(analysis.consensus.decision))}
                  </dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-[10px] uppercase tracking-[0.03em] text-muted-foreground">
                    {t("qa.analysis.consensus.score")}
                  </dt>
                  <dd className="font-mono text-[12px] text-foreground">
                    {formatAnalysisNumber(analysis.consensus.score, 1)}
                  </dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-[10px] uppercase tracking-[0.03em] text-muted-foreground">
                    {t("qa.analysis.consensus.agreement")}
                  </dt>
                  <dd className="font-mono text-[12px] text-foreground">
                    {Number.isFinite(analysis.consensus.agreement)
                      ? `${Math.round(analysis.consensus.agreement * 100)}%`
                      : "—"}
                  </dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-[10px] uppercase tracking-[0.03em] text-muted-foreground">
                    {t("qa.analysis.consensus.timeframes")}
                  </dt>
                  <dd className="font-mono text-[12px] text-foreground">{analysis.consensus.timeframeCount}</dd>
                </div>
              </dl>
            </div>
          ) : null}
        </div>
      </Surface>

      {/* 1b — `error` is NOT coupled to `status`: a completed run still records
          that the model's own answer had to be repaired or could not be used at
          all, and the levels below are then the engine's fallback rather than
          anything a model reasoned about. Rendering the row without this note
          would present a fallback as an analysis. */}
      {analysis.error ? (
        <Surface padding="sm" className="border-warning/40">
          <p className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-warning">
            <TriangleAlert className="h-3.5 w-3.5" aria-hidden="true" />
            {t("qa.analysis.notice.title")}
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            {t("qa.analysis.notice.body")}
          </p>
          <p className="mt-1.5 break-words font-mono text-[10px] text-muted-foreground/80">
            {analysis.error}
          </p>
        </Surface>
      ) : null}

      {/* 2 — price strip. Upstream collapses it to CURRENT alone on HOLD. */}
      <Surface padding="sm">
        <dl className={cn("grid gap-x-4 gap-y-3", isHold ? "grid-cols-1" : "grid-cols-2 sm:grid-cols-4")}>
          <div className="min-w-0">
            <dt className="text-[10px] uppercase tracking-[0.03em] text-info">{t("qa.analysis.price.current")}</dt>
            <dd dir="ltr" className="truncate font-mono text-base font-bold text-foreground">
              {formatAnalysisPrice(analysis.currentPrice)}
            </dd>
          </div>
          {!isHold ? (
            <>
              <div className="min-w-0">
                <dt className="text-[10px] uppercase tracking-[0.03em] text-muted-foreground">
                  {t("qa.analysis.price.entry")}
                </dt>
                <dd dir="ltr" className="truncate font-mono text-base font-bold text-foreground">
                  {formatAnalysisPrice(analysis.entryPrice)}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="text-[10px] uppercase tracking-[0.03em] text-sell">{t("qa.analysis.price.stop_loss")}</dt>
                <dd dir="ltr" className="truncate font-mono text-base font-bold text-sell">
                  {formatAnalysisPrice(analysis.stopLoss)}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="text-[10px] uppercase tracking-[0.03em] text-buy">{t("qa.analysis.price.take_profit")}</dt>
                <dd dir="ltr" className="truncate font-mono text-base font-bold text-buy">
                  {formatAnalysisPrice(analysis.takeProfit)}
                </dd>
              </div>
            </>
          ) : null}
        </dl>

        {isHold ? (
          <p className="mt-2 text-[11px] text-muted-foreground">{t("qa.analysis.price.hold_note")}</p>
        ) : null}

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border pt-2 text-[11px] text-muted-foreground">
          <span>
            <span className="font-medium text-foreground/80">{t("qa.analysis.position_size")}:</span>{" "}
            <span className="font-mono">
              {analysis.positionSizePct == null ? "—" : `${formatAnalysisNumber(analysis.positionSizePct, 1)}%`}
            </span>
          </span>
          <span>
            <span className="font-medium text-foreground/80">{t("qa.analysis.horizon_label")}:</span>{" "}
            {analysis.horizon ? t(`qa.analysis.horizon.${analysis.horizon}`) : "—"}
          </span>
          {runAt ? (
            <span>
              <span className="font-medium text-foreground/80">{t("qa.analysis.created_at")}:</span>{" "}
              <span className="font-mono">{runAt}</span>
            </span>
          ) : null}
        </div>
      </Surface>

      {/* 3 — multi-horizon outlook, 2×2 on mobile */}
      {outlookRows.length ? (
        <ReportSection title={t("qa.analysis.outlook.title")} icon={<CalendarClock aria-hidden="true" />}>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {outlookRows.map((row) => {
              const legTone = outlookTone(row.leg.label);
              return (
                <div key={row.key} className="min-w-0 rounded-lg border border-border/60 bg-muted/20 px-2 py-2 text-center">
                  <p className="truncate text-[10px] uppercase tracking-[0.03em] text-muted-foreground">
                    {t(row.labelKey)}
                  </p>
                  <p className={cn("mt-0.5 text-[13px] font-bold", DECISION_TEXT_CLASS[legTone])}>
                    {t(`qa.analysis.outlook.label.${row.leg.label}`)}
                  </p>
                  <p className="mt-0.5 flex flex-wrap items-center justify-center gap-x-1.5 text-[10px] text-muted-foreground">
                    <span className="font-mono">{formatAnalysisNumber(row.leg.score, 2)}</span>
                    <span>{t(`qa.analysis.outlook.qualifier.${row.leg.qualifier}`)}</span>
                  </p>
                </div>
              );
            })}
          </div>
        </ReportSection>
      ) : null}

      {/* 4 — four-factor score bars */}
      <ReportSection title={t("qa.analysis.scores.title")} icon={<Gauge aria-hidden="true" />}>
        <div className="space-y-2.5">
          {(
            [
              { key: "technical", value: analysis.scores.technical },
              { key: "fundamental", value: analysis.scores.fundamental },
              { key: "sentiment", value: analysis.scores.sentiment },
              { key: "overall", value: analysis.scores.overall },
            ] as const
          ).map((row) => (
            <div key={row.key}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-[11px] text-muted-foreground">{t(`qa.analysis.scores.${row.key}`)}</span>
                <span className="font-mono text-sm font-bold text-foreground">{formatAnalysisScore(row.value)}</span>
              </div>
              <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                {row.value == null || !Number.isFinite(row.value) ? null : (
                  <div
                    className={cn("h-full rounded-full", scoreBarClass(row.value))}
                    style={{ width: `${Math.max(0, Math.min(100, row.value))}%` }}
                  />
                )}
              </div>
              {row.value == null ? (
                <p className="mt-0.5 text-[10px] text-muted-foreground">{t("qa.analysis.scores.no_source")}</p>
              ) : null}
            </div>
          ))}
        </div>
      </ReportSection>

      {/* 5 — detailed analysis */}
      {detailBlocks.length ? (
        <ReportSection title={t("qa.analysis.detail.title")} icon={<FileText aria-hidden="true" />}>
          <div className="space-y-3">
            {detailBlocks.map((block) => (
              <div key={block.key} className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-muted-foreground [&_svg]:h-3.5 [&_svg]:w-3.5">{block.icon}</span>
                  <span className="text-[12px] font-semibold text-foreground">
                    {t(`qa.analysis.detail.${block.key}`)}
                  </span>
                  <span className="ms-auto rounded-full border border-border bg-card px-2 py-0.5 font-mono text-[11px] text-foreground">
                    {formatAnalysisScore(block.score)}
                  </span>
                </div>
                <p className="mt-1.5 whitespace-pre-line break-words text-[12px] leading-relaxed text-muted-foreground">
                  {block.text}
                </p>
              </div>
            ))}
          </div>
        </ReportSection>
      ) : null}

      {/* 6 — key reasons & risks */}
      {analysis.reasons.length || analysis.risks.length ? (
        <ReportSection title={t("qa.analysis.reasons_risks.title")} icon={<Lightbulb aria-hidden="true" />}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {analysis.reasons.length ? (
              <div className="min-w-0">
                <p className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.03em] text-buy">
                  <Lightbulb className="h-3 w-3" aria-hidden="true" />
                  {t("qa.analysis.reasons")}
                </p>
                <ul className="mt-1 space-y-1">
                  {analysis.reasons.map((reason, index) => (
                    <li key={index} className="flex gap-2 text-[12px] leading-relaxed text-muted-foreground">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-buy" aria-hidden="true" />
                      <span className="min-w-0 break-words">{reason}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {analysis.risks.length ? (
              <div className="min-w-0">
                <p className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.03em] text-warning">
                  <ShieldAlert className="h-3 w-3" aria-hidden="true" />
                  {t("qa.analysis.risks")}
                </p>
                <ul className="mt-1 space-y-1">
                  {analysis.risks.map((risk, index) => (
                    <li key={index} className="flex gap-2 text-[12px] leading-relaxed text-muted-foreground">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-warning" aria-hidden="true" />
                      <span className="min-w-0 break-words">{risk}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </ReportSection>
      ) : null}

      {/* 7 — data quality: what the engine did NOT have */}
      <DataQualityNotice analysis={analysis} />
    </div>
  );
}

/**
 * The honesty footer. Upstream has no equivalent — it silently substitutes 50
 * for every component it could not source. We name them instead, so a reader
 * can tell a scored dimension from an unavailable one.
 */
export function DataQualityNotice({ analysis }: { analysis: QuantAnalysisRecord }) {
  const { t } = useLocale();
  const quality = analysis.dataQuality;
  if (!quality) return null;

  return (
    <Surface
      padding="sm"
      className={cn(quality.degraded && "border-warning/40")}
      data-testid="quant-analysis-data-quality"
    >
      <p className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-foreground">
        <TriangleAlert
          className={cn("h-3.5 w-3.5", quality.degraded ? "text-warning" : "text-muted-foreground")}
          aria-hidden="true"
        />
        {t("qa.analysis.data_quality.title")}
      </p>
      <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
        {t(quality.degraded ? "qa.analysis.data_quality.degraded" : "qa.analysis.data_quality.complete")}
      </p>
      {quality.missing.length ? (
        <div className="mt-2">
          <p className="text-[10px] uppercase tracking-[0.03em] text-muted-foreground">
            {t("qa.analysis.data_quality.missing")}
          </p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {quality.missing.map((code) => (
              <span
                key={code}
                className="rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[11px] text-muted-foreground"
              >
                {missingLabel(t, code)}
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </Surface>
  );
}
