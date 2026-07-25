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
import { TriangleAlert } from "lucide-react";
import type { ResultEnvelope } from "@/lib/agent/resultEnvelope";
import { useLocale } from "@/hooks/useLocale";
import { envelopeBadge, type BadgeTone } from "@/lib/agent/executionModeBadge";
import { userMessageForFailure } from "@/lib/agent/errorTaxonomy";

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
