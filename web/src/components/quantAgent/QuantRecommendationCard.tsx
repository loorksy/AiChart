"use client";

/**
 * Shared Quant Agent recommendation card. Structurally mirrors QuantDinger's
 * `FastAnalysisReport.vue` decision card (direction-colored accent bar,
 * confidence ring, price row, reasons/risks) as closely as our data model
 * honestly supports — DESIGN.md forbids gradients/glow, so the accent bar is
 * a solid fill rather than QuantDinger's gradient. Reasons/risks/indicators
 * are read from `rec.evidence`, the SAME data `quant-agent`'s planner already
 * sends on the wire (`planner.py:build_recommendation` — `evidence.signal`
 * raw indicator dump, `evidence.corroborating_strategies` /
 * `evidence.conflicting_strategies` from strategy-combination) — nothing
 * here is fabricated; sections that would need data we don't have (trend
 * outlook, technical/fundamental/sentiment scores, feedback capture) are
 * simply not rendered rather than faked.
 */
import { useId } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  Radar,
  ShieldAlert,
  Users,
} from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { cn } from "@/lib/utils";
import type { QuantRecommendation } from "@/lib/quantAgent/types";

export const PLAN_TYPE_LABEL: Record<string, string> = {
  immediate: "rec.plan_type.immediate",
  anticipatory: "rec.plan_type.anticipatory",
  conditional: "rec.plan_type.conditional",
};

export function formatNumber(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return String(value);
}

interface ConflictingStrategy {
  strategy_id: string;
  direction: string;
}

function isConflictingStrategy(value: unknown): value is ConflictingStrategy {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Record<string, unknown>).strategy_id === "string" &&
    typeof (value as Record<string, unknown>).direction === "string"
  );
}

function readEvidenceReasons(rec: QuantRecommendation): string[] {
  return rec.rationale
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);
}

function readCorroboratingStrategies(rec: QuantRecommendation): string[] {
  const list = (rec.evidence as Record<string, unknown> | undefined)?.corroborating_strategies;
  if (!Array.isArray(list)) return [];
  return list.filter((item): item is string => typeof item === "string");
}

function readConflictingStrategies(rec: QuantRecommendation): ConflictingStrategy[] {
  const list = (rec.evidence as Record<string, unknown> | undefined)?.conflicting_strategies;
  if (!Array.isArray(list)) return [];
  return list.filter(isConflictingStrategy);
}

/** `evidence.signal` is a strategy-specific raw-indicator dump (e.g. `{ema20, adx14, atr14, close}`) — render whatever numeric keys are actually present, nothing assumed. */
function readIndicators(rec: QuantRecommendation): [string, number][] {
  const signal = (rec.evidence as Record<string, unknown> | undefined)?.signal;
  if (typeof signal !== "object" || signal === null) return [];
  return Object.entries(signal as Record<string, unknown>).filter(
    (entry): entry is [string, number] => typeof entry[1] === "number" && Number.isFinite(entry[1]),
  );
}

function ConfidenceRing({ confidence, tone }: { confidence: number; tone: "buy" | "sell" }) {
  const id = useId();
  const pct = Math.max(0, Math.min(1, confidence));
  const radius = 15;
  const circumference = 2 * Math.PI * radius;
  return (
    <div className="relative flex size-9 shrink-0 items-center justify-center" role="img" aria-labelledby={id}>
      <span id={id} className="sr-only">
        {Math.round(pct * 100)}%
      </span>
      <svg viewBox="0 0 36 36" className="size-9 -rotate-90">
        <circle cx="18" cy="18" r={radius} fill="none" strokeWidth="3" className="stroke-border" />
        <circle
          cx="18"
          cy="18"
          r={radius}
          fill="none"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - pct)}
          className={tone === "buy" ? "stroke-buy" : "stroke-sell"}
        />
      </svg>
      <span className="absolute text-[9px] font-semibold text-foreground">{Math.round(pct * 100)}%</span>
    </div>
  );
}

export function QuantRecommendationCard({ rec }: { rec: QuantRecommendation }) {
  const { t, dir, locale } = useLocale();
  const expires = rec.validity_expires_at
    ? new Date(rec.validity_expires_at).toLocaleString(locale === "ar" ? "ar" : "en", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;
  const isBuy = rec.direction === "buy";
  const reasons = readEvidenceReasons(rec);
  const corroborating = readCorroboratingStrategies(rec);
  const conflicting = readConflictingStrategies(rec);
  const indicators = readIndicators(rec);

  return (
    <div
      dir={dir}
      data-testid="quant-agent-recommendation-card"
      className="overflow-hidden rounded-xl border border-border bg-card"
    >
      <div className={cn("h-1", isBuy ? "bg-buy" : "bg-sell")} aria-hidden />

      <div className="p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={cn(
              "inline-flex items-center gap-1 text-sm font-bold",
              isBuy ? "text-buy" : "text-sell",
            )}
          >
            {isBuy ? (
              <ArrowUpRight className="h-4 w-4" aria-hidden />
            ) : (
              <ArrowDownRight className="h-4 w-4" aria-hidden />
            )}
            {t(`decision.${rec.direction}`)}
          </span>
          <span className="font-mono text-sm text-foreground">{rec.symbol}</span>
          <span className="text-[11px] text-muted-foreground">{rec.interval}</span>
          <span className="rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[11px] text-foreground">
            {t(PLAN_TYPE_LABEL[rec.plan_type] ?? "rec.plan_type.immediate")}
          </span>
          <span className="ms-auto inline-flex items-center gap-1 rounded-full border border-info/40 bg-info/10 px-2 py-0.5 text-[11px] font-medium text-info">
            <Radar className="h-3 w-3" aria-hidden />
            {t("qa.page.badge")}
          </span>
          <ConfidenceRing confidence={rec.confidence} tone={isBuy ? "buy" : "sell"} />
        </div>

        <dl className="mt-3 grid grid-cols-3 gap-x-4 gap-y-2">
          <div className="min-w-0">
            <dt className="text-[11px] text-muted-foreground">{t("qa.card.entry")}</dt>
            <dd className="font-mono text-[12px] text-foreground">{formatNumber(rec.entry)}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-[11px] text-muted-foreground">{t("qa.card.stop_loss")}</dt>
            <dd className="font-mono text-[12px] text-sell">{formatNumber(rec.stop_loss)}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-[11px] text-muted-foreground">{t("qa.card.take_profit")}</dt>
            <dd className="font-mono text-[12px] text-buy">{formatNumber(rec.take_profit)}</dd>
          </div>
        </dl>

        {rec.targets.length ? (
          <p className="mt-2 text-[11px] text-muted-foreground">
            <span className="font-medium text-foreground/80">{t("qa.card.targets")}:</span>{" "}
            <span className="font-mono">{rec.targets.map((tgt) => formatNumber(tgt)).join(" · ")}</span>
          </p>
        ) : null}

        {reasons.length || conflicting.length ? (
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {reasons.length ? (
              <div>
                <p className="text-[11px] font-medium text-buy">{t("qa.card.reasons")}</p>
                <ul className="mt-1 space-y-0.5">
                  {reasons.map((reason, i) => (
                    <li key={i} className="text-[11px] text-muted-foreground">
                      • {reason}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {conflicting.length ? (
              <div>
                <p className="inline-flex items-center gap-1 text-[11px] font-medium text-warning">
                  <ShieldAlert className="h-3 w-3" aria-hidden />
                  {t("qa.card.risks")}
                </p>
                <ul className="mt-1 space-y-0.5">
                  {conflicting.map((c) => (
                    <li key={c.strategy_id} className="text-[11px] text-muted-foreground">
                      • {t("qa.card.conflicting_strategy", { strategy: c.strategy_id, direction: t(`decision.${c.direction}`) })}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}

        {corroborating.length ? (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
              <Users className="h-3 w-3" aria-hidden />
              {t("qa.card.corroborating")}:
            </span>
            {corroborating.map((id) => (
              <span key={id} className="rounded-full border border-buy/30 bg-buy/10 px-2 py-0.5 text-[11px] text-buy">
                {id}
              </span>
            ))}
          </div>
        ) : null}

        {indicators.length ? (
          <dl className="mt-3 grid grid-cols-3 gap-x-4 gap-y-1.5 rounded-lg border border-border/60 bg-muted/20 p-2 sm:grid-cols-4">
            {indicators.map(([key, value]) => (
              <div key={key} className="min-w-0">
                <dt className="truncate text-[10px] text-muted-foreground">{key}</dt>
                <dd className="font-mono text-[11px] text-foreground">{value.toFixed(5)}</dd>
              </div>
            ))}
          </dl>
        ) : null}

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
          <span>
            <span className="font-medium text-foreground/80">{t("qa.card.strategy")}:</span>{" "}
            {rec.strategy_id} ({rec.strategy_version})
          </span>
          {rec.regime ? (
            <span>
              <span className="font-medium text-foreground/80">{t("qa.card.regime")}:</span> {rec.regime}
            </span>
          ) : null}
          <span>
            <span className="font-medium text-foreground/80">{t("qa.card.validity")}:</span>{" "}
            {expires ?? t("qa.card.no_expiry")}
          </span>
        </div>
      </div>
    </div>
  );
}
