"use client";

/**
 * Active recommendations with their full explainable state (Group 9).
 *
 * Each card shows the three-layer plan from the effective revision — direction,
 * plan type, execution state, revision number, entry zone, activation
 * condition, validity, invalidation rule, alternative scenario — plus the
 * evidence card dimension by dimension (never one blended score), the decision
 * trace (hypotheses / chosen-because / plan-type-because), the last
 * re-evaluation trigger, and the last automatic-execution skip.
 */
import { useCallback, useEffect, useState } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  Clock3,
  RefreshCw,
  ScrollText,
  ShieldCheck,
  SkipForward,
  TriangleAlert,
} from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { cn } from "@/lib/utils";
import { RecommendationTrackerCard } from "@/components/recommendations/RecommendationTrackerCard";
import type { ActiveRecommendationView } from "@/app/api/recommendations/active/route";
import type { DimensionGrade, EvidenceDimension } from "@/lib/agent/evidenceDimensions";

const GRADE_CLASSES: Record<DimensionGrade, string> = {
  strong: "text-emerald-700 dark:text-emerald-300",
  moderate: "text-sky-700 dark:text-sky-300",
  weak: "text-amber-700 dark:text-amber-300",
  unavailable: "text-muted-foreground",
};

const EXEC_STATE_CLASSES: Record<string, string> = {
  valid_now: "border-emerald-500/45 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  awaiting_activation: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  expired: "border-border bg-muted/40 text-muted-foreground",
  invalidated: "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300",
  blocked: "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300",
};

/** Both spellings the revision bundles use for the dimension list. */
function dimensionsOf(
  evidence: { evidenceDimensions?: unknown; dimensions?: unknown } | null,
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

function traceOf(trace: Record<string, unknown> | null): {
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

function ActiveRecommendationDetailCard({ rec }: { rec: ActiveRecommendationView }) {
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
      data-testid="active-recommendation-card"
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
                      <span className="ms-1 text-emerald-700 dark:text-emerald-300">
                        {t("rec.detail.trace.supporting")}: {h.supporting.join("، ")}
                      </span>
                    ) : null}
                    {h.opposing?.length ? (
                      <span className="ms-1 text-red-700 dark:text-red-300">
                        {t("rec.detail.trace.opposing")}: {h.opposing.join("، ")}
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
        <p className="mt-1 flex items-start gap-1.5 text-[11px] text-amber-600 dark:text-amber-400">
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

export function ActiveRecommendationsPanel() {
  const { t, dir } = useLocale();
  const [recs, setRecs] = useState<ActiveRecommendationView[] | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/recommendations/active", { cache: "no-store" });
      if (!res.ok) throw new Error("load failed");
      const json = (await res.json()) as { recommendations?: ActiveRecommendationView[] };
      setRecs(json.recommendations ?? []);
      setError(false);
    } catch {
      setError(true);
      setRecs((prev) => prev ?? []);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section dir={dir} data-testid="active-recommendations-panel">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-muted-foreground">
          {t("rec.page.active")}
          {recs?.length ? ` (${recs.length})` : ""}
        </h2>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void load().finally(() => setBusy(false));
          }}
          className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-xs text-foreground hover:bg-muted disabled:opacity-50"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", busy && "animate-spin")} aria-hidden />
          {t("rec.page.refresh")}
        </button>
      </div>

      {error ? (
        <p className="mb-2 flex items-center gap-1.5 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive-foreground">
          <TriangleAlert className="h-3.5 w-3.5" aria-hidden />
          {t("rec.active.error")}
        </p>
      ) : null}

      {recs == null ? null : recs.length === 0 ? (
        <p className="rounded-lg border border-border bg-card p-6 text-center text-sm text-muted-foreground">
          {t("rec.active.empty")}
        </p>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {recs.map((rec) => (
            <ActiveRecommendationDetailCard key={rec.id} rec={rec} />
          ))}
        </div>
      )}
    </section>
  );
}
