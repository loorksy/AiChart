"use client";

/**
 * The recommendation's full explainable report, on its own page.
 *
 * The signals list deliberately shows only the compact verdict card; every
 * deeper layer — the three-layer plan (direction, plan type, execution state),
 * the revision number, entry zone, activation condition, validity,
 * invalidation rule, alternative scenario, the evidence card dimension by
 * dimension (never one blended score), the decision trace, the last
 * re-evaluation trigger and the last automatic-execution skip — renders here.
 *
 * Active plans arrive enriched (ActiveRecommendationView); closed/history
 * plans carry only the tracked shape, so every enriched section guards its
 * own presence.
 */
import {
  ArrowDownRight,
  ArrowUpRight,
  Clock3,
  Eye,
  ScrollText,
  ShieldCheck,
  SkipForward,
} from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { cn } from "@/lib/utils";
import { RecommendationTrackerCard } from "@/components/recommendations/RecommendationTrackerCard";
import type { ActiveRecommendationView } from "@/app/api/recommendations/active/route";
import type { TrackedRecommendation } from "@/lib/recommendations/types";
import type { DimensionGrade, EvidenceDimension } from "@/lib/agent/evidenceDimensions";

/** Active-only enrichments; absent on closed/history plans. */
type Enrichment = Pick<
  ActiveRecommendationView,
  | "activationCondition"
  | "tradability"
  | "evidence"
  | "decisionTrace"
  | "lastReevaluation"
  | "lastExecutionSkip"
>;

export type FullReportRecommendation = TrackedRecommendation & Partial<Enrichment>;

const GRADE_CLASSES: Record<DimensionGrade, string> = {
  strong: "text-buy",
  moderate: "text-info",
  weak: "text-warning",
  unavailable: "text-muted-foreground",
};

/** Tradability verdicts, styled by urgency: actionable → amber-near → watch. */
const TRADABILITY_CLASSES: Record<string, string> = {
  now: "border-buy/45 bg-buy/10 text-buy",
  soon: "border-warning/40 bg-warning/10 text-warning",
  watch_only: "border-border bg-muted/40 text-muted-foreground",
};

const EXEC_STATE_CLASSES: Record<string, string> = {
  valid_now: "border-buy/45 bg-buy/10 text-buy",
  awaiting_activation: "border-warning/40 bg-warning/10 text-warning",
  expired: "border-border bg-muted/40 text-muted-foreground",
  invalidated: "border-destructive/40 bg-destructive/10 text-destructive",
  blocked: "border-destructive/40 bg-destructive/10 text-destructive",
};

/** Both spellings the revision bundles use for the dimension list. */
function dimensionsOf(
  evidence: { evidenceDimensions?: unknown; dimensions?: unknown } | null | undefined,
): EvidenceDimension[] {
  if (!evidence) return [];
  const raw = evidence.evidenceDimensions ?? evidence.dimensions;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (item): item is EvidenceDimension =>
      typeof item === "object" && item != null && "key" in item && "grade" in item,
  );
}

interface TraceHypothesis {
  scenario: string;
  supporting?: string[];
  opposing?: string[];
}

function traceOf(trace: Record<string, unknown> | null | undefined): {
  hypotheses: TraceHypothesis[];
  chosenBecause: string | null;
  planTypeBecause: string | null;
} {
  const hypotheses = Array.isArray(trace?.hypotheses)
    ? (trace!.hypotheses as unknown[]).filter(
        (h): h is TraceHypothesis =>
          typeof h === "object" && h != null && typeof (h as TraceHypothesis).scenario === "string",
      )
    : [];
  const chosenBecause =
    typeof trace?.chosenBecause === "string" && trace.chosenBecause ? trace.chosenBecause : null;
  const planTypeBecause =
    typeof trace?.planTypeBecause === "string" && trace.planTypeBecause
      ? trace.planTypeBecause
      : null;
  return { hypotheses, chosenBecause, planTypeBecause };
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className="text-[12px] text-foreground">{children}</dd>
    </div>
  );
}

export function RecommendationFullReport({ rec }: { rec: FullReportRecommendation }) {
  const { t, dir, locale } = useLocale();
  const dims = dimensionsOf(rec.evidence);
  const trace = traceOf(rec.decisionTrace);
  const execState = rec.executionState ?? "awaiting_activation";
  const entryZone =
    rec.entryLow != null && rec.entryHigh != null
      ? `${rec.entryLow} – ${rec.entryHigh}`
      : rec.entry
        ? String(rec.entry)
        : null;
  const expires = rec.expiresAt
    ? new Date(rec.expiresAt).toLocaleString(locale === "ar" ? "ar" : "en", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  return (
    <div
      dir={dir}
      data-testid="recommendation-full-report"
      className="rounded-xl border border-border bg-card p-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={cn(
            "inline-flex items-center gap-1 text-sm font-bold",
            rec.direction === "buy" ? "text-buy" : "text-sell",
          )}
        >
          {rec.direction === "buy" ? (
            <ArrowUpRight className="h-4 w-4" aria-hidden />
          ) : (
            <ArrowDownRight className="h-4 w-4" aria-hidden />
          )}
          {t(`decision.${rec.direction}`)}
        </span>
        <span className="font-mono text-sm text-foreground">{rec.symbol}</span>
        <span className="text-[11px] text-muted-foreground">{rec.interval}</span>
        {rec.planType ? (
          <span className="rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[11px] text-foreground">
            {t(`rec.plan_type.${rec.planType}`)}
          </span>
        ) : null}
        <span
          className={cn(
            "rounded-full border px-2 py-0.5 text-[11px] font-medium",
            EXEC_STATE_CLASSES[execState] ?? EXEC_STATE_CLASSES.awaiting_activation,
          )}
        >
          {t(`rec.exec_state.${execState}`)}
        </span>
        {rec.tradability && rec.tradability.verdict !== "now" ? (
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
              TRADABILITY_CLASSES[rec.tradability.verdict] ?? TRADABILITY_CLASSES.watch_only,
            )}
          >
            {rec.tradability.verdict === "watch_only" ? (
              <Eye className="h-3 w-3" aria-hidden />
            ) : null}
            {t(`rec.tradability.${rec.tradability.verdict}`)}
            {rec.tradability.entryDistanceAtr != null
              ? ` · ${rec.tradability.entryDistanceAtr} ATR`
              : ""}
          </span>
        ) : null}
        {rec.revisionNo != null ? (
          <span className="ms-auto rounded-md bg-muted/50 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
            {t("rec.detail.revision")} #{rec.revisionNo}
          </span>
        ) : null}
      </div>

      <div className="mt-3">
        <RecommendationTrackerCard rec={rec} />
      </div>

      <dl className="mt-3 grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2">
        {entryZone ? <Field label={t("rec.detail.entry_zone")}>{entryZone}</Field> : null}
        {rec.activationCondition ? (
          <Field label={t("rec.detail.activation")}>{rec.activationCondition}</Field>
        ) : null}
        <Field label={t("rec.detail.validity")}>
          {expires ? `${t("rec.detail.expires")}: ${expires}` : "—"}
          {rec.validityCandles != null
            ? ` · ${t("rec.detail.max_candles", { n: String(rec.validityCandles) })}`
            : ""}
        </Field>
        {rec.invalidationRule ? (
          <Field label={t("rec.detail.invalidation")}>{rec.invalidationRule}</Field>
        ) : null}
        {rec.alternativeScenario ? (
          <Field label={t("rec.detail.alternative")}>{rec.alternativeScenario}</Field>
        ) : null}
      </dl>

      {dims.length ? (
        <div className="mt-3 rounded-lg border border-border/60 bg-muted/20 px-3 py-2">
          <p className="flex items-center gap-1.5 text-[12px] font-semibold text-foreground">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
            {t("rec.detail.evidence")}
          </p>
          <ul className="mt-1.5 space-y-1">
            {dims.map((dim) => (
              <li key={dim.key} className="flex items-start gap-2 text-[11px]">
                <span className={cn("shrink-0 font-semibold", GRADE_CLASSES[dim.grade])}>
                  {t(`ev.grade.${dim.grade}`)}
                </span>
                <span className="text-muted-foreground">
                  {dim.detail}
                  {dim.value !== undefined ? (
                    <span className="ms-1 font-mono text-foreground/70">({dim.value})</span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {trace.hypotheses.length || trace.chosenBecause || trace.planTypeBecause ? (
        <div className="mt-3 rounded-lg border border-border/60 bg-muted/20 px-3 py-2">
          <p className="flex items-center gap-1.5 text-[12px] font-semibold text-foreground">
            <ScrollText className="h-3.5 w-3.5" aria-hidden />
            {t("rec.detail.trace")}
          </p>
          {trace.hypotheses.length ? (
            <div className="mt-1.5">
              <p className="text-[11px] font-medium text-muted-foreground">
                {t("rec.detail.trace.hypotheses")}
              </p>
              <ul className="mt-0.5 space-y-1">
                {trace.hypotheses.map((h, i) => (
                  <li key={i} className="text-[11px] text-muted-foreground">
                    <span className="text-foreground">{h.scenario}</span>
                    {h.supporting?.length ? (
                      <span className="ms-1 text-buy">
                        {t("rec.detail.trace.supporting")}: {h.supporting.join(" · ")}
                      </span>
                    ) : null}
                    {h.opposing?.length ? (
                      <span className="ms-1 text-sell">
                        {t("rec.detail.trace.opposing")}: {h.opposing.join(" · ")}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {trace.chosenBecause ? (
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              <span className="font-medium">{t("rec.detail.trace.chosen")}:</span>{" "}
              {trace.chosenBecause}
            </p>
          ) : null}
          {trace.planTypeBecause ? (
            <p className="mt-1 text-[11px] text-muted-foreground">
              <span className="font-medium">{t("rec.detail.trace.plan_type_because")}:</span>{" "}
              {trace.planTypeBecause}
            </p>
          ) : null}
        </div>
      ) : null}

      {rec.lastReevaluation ? (
        <p className="mt-2 flex items-start gap-1.5 text-[11px] text-muted-foreground">
          <Clock3 className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>
            <span className="font-medium text-foreground/80">
              {t("rec.detail.last_trigger")}:
            </span>{" "}
            {rec.lastReevaluation.detail || rec.lastReevaluation.reason} (
            {rec.lastReevaluation.source} · {rec.lastReevaluation.outcome})
          </span>
        </p>
      ) : null}

      {rec.lastExecutionSkip ? (
        <p className="mt-1 flex items-start gap-1.5 text-[11px] text-warning">
          <SkipForward className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>
            <span className="font-medium">{t("rec.detail.last_skip")}:</span>{" "}
            {rec.lastExecutionSkip.code}
          </span>
        </p>
      ) : null}
    </div>
  );
}
