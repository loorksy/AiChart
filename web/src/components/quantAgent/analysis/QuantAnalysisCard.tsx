"use client";

/**
 * Compact Quant Agent analysis card — the inline/chat surface for one stored
 * `QuantAnalysisRecord`.
 *
 * Ported from QuantDinger (https://github.com/OpenByteInc/QuantDinger),
 * Copyright Open Byte Inc., licensed under the Apache License, Version 2.0
 * — `src/views/ai-analysis/components/CopilotWorkbench.vue:93-107` (the
 * `.copilot-report-card` bubble) plus the decision hero / price strip /
 * dimension scores / detailed-analysis accordion of
 * `FastAnalysisReport.vue`.
 *
 * What changed: upstream renders the FULL report inside the chat bubble —
 * there is no compact variant, and no symbol or market anywhere on it
 * (a real gap: the reader cannot tell what was analysed). Here the bubble is
 * a summary — market:symbol line, verdict, confidence, clamped summary,
 * entry/stop/target, four score chips — and the "Detailed analysis"
 * disclosure opens the prose, reasons and risks in place exactly as
 * upstream's accordion does. The complete report lives one link away on
 * `/quant-agent/analysis`. Upstream's Export-PDF and Ask-follow-up actions are
 * not ported: there is no PDF endpoint on this platform, and the composer is
 * already right there.
 */
import { useState } from "react";
import Link from "next/link";
import { ChevronDown, ExternalLink, Lightbulb, Radar, ShieldAlert, TriangleAlert } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { Surface } from "@/components/foundation";
import { cn } from "@/lib/utils";
import type { QuantAnalysisRecord } from "@/lib/quantAgent/types";
import {
  DECISION_BAR_CLASS,
  DECISION_TEXT_CLASS,
  DecisionIcon,
  decisionLabelKey,
  decisionTone,
  formatAnalysisPrice,
  formatAnalysisScore,
} from "./QuantAnalysisReport";

export interface QuantAnalysisCardProps {
  analysis: QuantAnalysisRecord;
  className?: string;
}

export function QuantAnalysisCard({ analysis, className }: QuantAnalysisCardProps) {
  const { t, dir } = useLocale();
  const [detailOpen, setDetailOpen] = useState(false);
  const tone = decisionTone(analysis.decision);
  const isHold = analysis.decision === "HOLD" || analysis.decision == null;
  const degraded = analysis.dataQuality?.degraded === true;

  const detailBlocks = analysis.detail
    ? (
        [
          { key: "technical", text: analysis.detail.technical },
          { key: "fundamental", text: analysis.detail.fundamental },
          { key: "sentiment", text: analysis.detail.sentiment },
        ] as const
      ).filter((block) => block.text.trim().length > 0)
    : [];
  const hasDetail = detailBlocks.length > 0 || analysis.reasons.length > 0 || analysis.risks.length > 0;

  if (analysis.status === "failed") {
    return (
      <Surface padding="sm" className={cn("mt-2 border-destructive/30", className)}>
        <div dir={dir} className="flex items-start gap-2">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-foreground">{t("qa.analysis.error.title")}</p>
            <p className="mt-0.5 font-mono text-[11px] text-muted-foreground" dir="ltr">
              {analysis.market}:{analysis.symbol} · {analysis.interval}
            </p>
            <p className="mt-1 break-words text-[12px] text-muted-foreground">
              {analysis.error ?? t("qa.analysis.error.generic")}
            </p>
          </div>
        </div>
      </Surface>
    );
  }

  return (
    <Surface padding="none" className={cn("mt-2 overflow-hidden", className)} data-testid="quant-analysis-card">
      <div className={cn("h-1", DECISION_BAR_CLASS[tone])} aria-hidden="true" />
      <div dir={dir} className="space-y-2 p-3">
        {/* market:symbol line */}
        <div className="flex flex-wrap items-center gap-2">
          <span dir="ltr" className="font-mono text-sm text-foreground">
            {analysis.market}:{analysis.symbol}
          </span>
          <span
            dir="ltr"
            className="rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[11px] text-muted-foreground"
          >
            {analysis.interval}
          </span>
          {degraded ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-[11px] font-medium text-warning">
              <TriangleAlert className="h-3 w-3" aria-hidden="true" />
              {t("qa.analysis.data_quality.title")}
            </span>
          ) : null}
          <span className="ms-auto inline-flex items-center gap-1 rounded-full border border-info/40 bg-info/10 px-2 py-0.5 text-[11px] font-medium text-info">
            <Radar className="h-3 w-3" aria-hidden="true" />
            {t("qa.analysis.card.badge")}
          </span>
        </div>

        {/* verdict + confidence pill */}
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn("inline-flex items-center gap-1 text-lg font-extrabold", DECISION_TEXT_CLASS[tone])}>
            <DecisionIcon tone={tone} className="h-5 w-5" />
            {analysis.decision ? t(decisionLabelKey(analysis.decision)) : "—"}
          </span>
          <span className="rounded-full border border-border bg-muted/40 px-2 py-0.5 font-mono text-[11px] text-foreground">
            {analysis.confidence == null ? "—" : `${Math.round(analysis.confidence)}%`}{" "}
            <span className="font-sans text-muted-foreground">{t("qa.analysis.confidence")}</span>
          </span>
        </div>

        {/* `error` is not coupled to `status`: a completed row still carries the
            note that the model's answer had to be repaired or was unusable, and
            the strip below is then a fallback rather than an analysed plan. */}
        {analysis.error ? (
          <p className="inline-flex items-start gap-1.5 rounded-lg border border-warning/40 bg-warning/10 px-2 py-1 text-[11px] text-warning">
            <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
            <span className="min-w-0 break-words">{t("qa.analysis.notice.title")}</span>
          </p>
        ) : null}

        {analysis.summary ? (
          <p className="line-clamp-3 break-words text-[12px] leading-relaxed text-muted-foreground">
            {analysis.summary}
          </p>
        ) : null}

        {/* entry / stop / target — upstream drops the three on a neutral verdict */}
        {isHold ? (
          // Upstream collapses the strip to CURRENT alone on a neutral
          // verdict (`price-info-row.hold-mode`); same here — a level the
          // engine did not issue is never drawn.
          <div className="space-y-1">
            <dl>
              <dt className="text-[10px] uppercase tracking-[0.03em] text-muted-foreground">
                {t("qa.analysis.price.current")}
              </dt>
              <dd dir="ltr" className="truncate font-mono text-[12px] text-foreground">
                {formatAnalysisPrice(analysis.currentPrice)}
              </dd>
            </dl>
            <p className="text-[11px] text-muted-foreground">{t("qa.analysis.price.hold_note")}</p>
          </div>
        ) : (
          <dl className="grid grid-cols-3 gap-x-3 gap-y-1">
            <div className="min-w-0">
              <dt className="text-[10px] uppercase tracking-[0.03em] text-muted-foreground">
                {t("qa.analysis.price.entry")}
              </dt>
              <dd dir="ltr" className="truncate font-mono text-[12px] text-foreground">
                {formatAnalysisPrice(analysis.entryPrice)}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-[10px] uppercase tracking-[0.03em] text-muted-foreground">
                {t("qa.analysis.price.stop_loss")}
              </dt>
              <dd dir="ltr" className="truncate font-mono text-[12px] text-sell">
                {formatAnalysisPrice(analysis.stopLoss)}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-[10px] uppercase tracking-[0.03em] text-muted-foreground">
                {t("qa.analysis.price.take_profit")}
              </dt>
              <dd dir="ltr" className="truncate font-mono text-[12px] text-buy">
                {formatAnalysisPrice(analysis.takeProfit)}
              </dd>
            </div>
          </dl>
        )}

        {/* four score chips */}
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              { key: "technical", value: analysis.scores.technical },
              { key: "fundamental", value: analysis.scores.fundamental },
              { key: "sentiment", value: analysis.scores.sentiment },
              { key: "overall", value: analysis.scores.overall },
            ] as const
          ).map((score) => (
            <span
              key={score.key}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[11px] text-muted-foreground"
            >
              {t(`qa.analysis.scores.${score.key}`)}
              <span className="font-mono text-foreground">{formatAnalysisScore(score.value)}</span>
            </span>
          ))}
        </div>

        {/* "Detailed analysis" — an in-place disclosure, as upstream's accordion is */}
        {hasDetail ? (
          <div className="border-t border-border pt-2">
            <button
              type="button"
              onClick={() => setDetailOpen((prev) => !prev)}
              aria-expanded={detailOpen}
              className="inline-flex min-h-11 items-center gap-1.5 text-[12px] font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-9"
            >
              <ChevronDown
                className={cn("h-3.5 w-3.5 transition-transform", !detailOpen && "ltr:-rotate-90 rtl:rotate-90")}
                aria-hidden="true"
              />
              {t(detailOpen ? "qa.analysis.detail.hide" : "qa.analysis.detail.show")}
            </button>

            {detailOpen ? (
              <div className="space-y-2 pt-1">
                {detailBlocks.map((block) => (
                  <div key={block.key} className="rounded-lg bg-muted/40 px-3 py-2">
                    <p className="text-[11px] font-semibold text-foreground">
                      {t(`qa.analysis.detail.${block.key}`)}
                    </p>
                    <p className="mt-1 whitespace-pre-line break-words text-[12px] leading-relaxed text-muted-foreground">
                      {block.text}
                    </p>
                  </div>
                ))}

                {analysis.reasons.length ? (
                  <div>
                    <p className="inline-flex items-center gap-1 text-[11px] font-semibold text-buy">
                      <Lightbulb className="h-3 w-3" aria-hidden="true" />
                      {t("qa.analysis.reasons")}
                    </p>
                    <ul className="mt-1 space-y-0.5">
                      {analysis.reasons.map((reason, index) => (
                        <li key={index} className="flex gap-2 text-[11px] text-muted-foreground">
                          <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-buy" aria-hidden="true" />
                          <span className="min-w-0 break-words">{reason}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {analysis.risks.length ? (
                  <div>
                    <p className="inline-flex items-center gap-1 text-[11px] font-semibold text-warning">
                      <ShieldAlert className="h-3 w-3" aria-hidden="true" />
                      {t("qa.analysis.risks")}
                    </p>
                    <ul className="mt-1 space-y-0.5">
                      {analysis.risks.map((risk, index) => (
                        <li key={index} className="flex gap-2 text-[11px] text-muted-foreground">
                          <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-warning" aria-hidden="true" />
                          <span className="min-w-0 break-words">{risk}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {analysis.dataQuality?.missing.length ? (
                  <p className="text-[11px] text-muted-foreground">
                    <span className="font-medium text-foreground/80">
                      {t("qa.analysis.data_quality.missing")}:
                    </span>{" "}
                    <span className="font-mono">{analysis.dataQuality.missing.join(" · ")}</span>
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        <Link
          href={`/quant-agent/analysis?id=${encodeURIComponent(analysis.id)}`}
          className="inline-flex min-h-11 items-center gap-1.5 text-[12px] font-medium text-info hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-9"
        >
          <ExternalLink className="h-3.5 w-3.5 rtl:-scale-x-100" aria-hidden="true" />
          {t("qa.analysis.card.open_full")}
        </Link>
      </div>
    </Surface>
  );
}
