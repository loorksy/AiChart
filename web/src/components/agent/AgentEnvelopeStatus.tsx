"use client";

/**
 * Phase-0 result transparency (RELIABILITY_PLAN.md items 11 + 7):
 * - AgentModeBadge: a persistent pill above every assistant analysis result
 *   stating the basis of the answer — descriptive (not executable), shadow,
 *   demo, live, or an operational blocker.
 * - AgentFaultCard: shown for an operational_blocker — the safe, simplified
 *   reason (never a raw provider payload) plus the retry stance and the
 *   trace_id the operator quotes to support.
 */
import { ShieldCheck, TriangleAlert } from "lucide-react";
import type { ResultEnvelope } from "@/lib/agent/resultEnvelope";
import { useLocale } from "@/hooks/useLocale";
import { envelopeBadge, type BadgeTone } from "@/lib/agent/executionModeBadge";
import { userMessageForFailure } from "@/lib/agent/errorTaxonomy";
import {
  summarizeEvidenceCard,
  type EvidenceCard,
} from "@/lib/agent/evidenceCard";

const TONE_CLASSES: Record<BadgeTone, string> = {
  descriptive:
    "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  shadow:
    "border-slate-400/40 bg-slate-400/10 text-slate-600 dark:text-slate-300",
  demo: "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  live: "border-emerald-500/45 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  blocker:
    "border-red-500/45 bg-red-500/10 text-red-700 dark:text-red-300",
};

export function AgentModeBadge({
  envelope,
}: {
  envelope?: ResultEnvelope | null;
}) {
  const { t } = useLocale();
  const badge = envelopeBadge(envelope);
  if (!badge) return null;
  const label = t(badge.labelKey);
  return (
    <span
      title={label}
      data-tone={badge.tone}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${TONE_CLASSES[badge.tone]}`}
    >
      {badge.tone === "blocker" ? (
        <TriangleAlert className="h-3 w-3 shrink-0" aria-hidden />
      ) : (
        <span
          className="h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-70"
          aria-hidden
        />
      )}
      <span>{label}</span>
    </span>
  );
}

/**
 * Evidence card (RELIABILITY_PLAN.md item 13). A recommendation used to show a
 * bare confidence number; this shows WHAT it rests on — the matched strategy,
 * how many historical trades, the walk-forward verdict, the deployment state,
 * and the realised live results. When the evidence does not meet the execution
 * gates that is stated plainly rather than hidden.
 */
export function AgentEvidenceCard({ card }: { card: EvidenceCard }) {
  const { t, locale } = useLocale();
  const gated = card.meetsExecutionGates;
  return (
    <div
      className={`mt-2 rounded-lg border px-3 py-2 text-[12px] ${
        gated
          ? "border-emerald-500/35 bg-emerald-500/[0.06]"
          : "border-border/60 bg-muted/30"
      }`}
    >
      <div className="flex items-center gap-1.5 font-semibold">
        <ShieldCheck className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span>{t("agent.evidence.title")}</span>
      </div>
      <p className="mt-1 text-muted-foreground">{summarizeEvidenceCard(card, locale)}</p>
      <dl className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
        <div className="flex justify-between gap-2">
          <dt>{t("agent.evidence.trades")}</dt>
          <dd className="font-mono text-foreground/80">{card.tradeCount}</dd>
        </div>
        {card.winRate != null ? (
          <div className="flex justify-between gap-2">
            <dt>{t("agent.evidence.win_rate")}</dt>
            <dd className="font-mono text-foreground/80">
              {Math.round(card.winRate * 100)}%
            </dd>
          </div>
        ) : null}
        {card.deploymentState ? (
          <div className="flex justify-between gap-2">
            <dt>{t("agent.evidence.deployment")}</dt>
            <dd className="text-foreground/80">{card.deploymentState}</dd>
          </div>
        ) : null}
        {card.liveSampleSize > 0 && card.liveWinRate != null ? (
          <div className="flex justify-between gap-2">
            <dt>{t("agent.evidence.live")}</dt>
            <dd className="font-mono text-foreground/80">
              {Math.round(card.liveWinRate * 100)}% · {card.liveSampleSize}
            </dd>
          </div>
        ) : null}
      </dl>
      {!gated ? (
        <p className="mt-1.5 text-amber-600 dark:text-amber-400">
          {t("agent.evidence.not_execution_grade")}
        </p>
      ) : null}
    </div>
  );
}

export function AgentFaultCard({ envelope }: { envelope: ResultEnvelope }) {
  const { t, locale } = useLocale();
  const reason = userMessageForFailure(envelope.failure_code ?? "unknown", locale);
  const retryHint = envelope.retryable
    ? t("agent.fault.retryable")
    : t("agent.fault.permanent");
  return (
    <div className="mt-1 rounded-lg border border-red-500/40 bg-red-500/[0.06] px-3 py-2 text-[12px]">
      <div className="flex items-center gap-1.5 font-semibold text-red-700 dark:text-red-300">
        <TriangleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span>{t("agent.fault.title")}</span>
      </div>
      <p className="mt-1 leading-relaxed text-foreground/90">{reason}</p>
      <p className="mt-1 text-muted-foreground">{retryHint}</p>
      {envelope.trace_id ? (
        <p
          className="mt-1.5 select-all font-mono text-[10px] text-muted-foreground"
          dir="ltr"
        >
          {t("agent.fault.trace")}: {envelope.trace_id}
        </p>
      ) : null}
    </div>
  );
}
