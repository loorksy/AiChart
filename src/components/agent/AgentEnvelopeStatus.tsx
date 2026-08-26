"use client";

/**
 * Phase-0 result transparency (RELIABILITY_PLAN.md items 11 + 7):
 * - AgentFaultCard: shown for an operational_blocker — the safe, simplified
 *   reason (never a raw provider payload) plus the retry stance and the
 *   trace_id the operator quotes to support.
 *
 * The old AgentModeBadge — the "descriptive — not authorized to execute"
 * pill stamped above EVERY assistant reply, greetings included — is gone.
 * Assistant turns are signed by the agent avatar instead, and the compliance
 * line lives ONCE as small print under the composer (SmartChartAgentPanel).
 */
import { ShieldCheck, TriangleAlert } from "lucide-react";
import type { ResultEnvelope } from "@/lib/agent/resultEnvelope";
import { useLocale } from "@/hooks/useLocale";
import { userMessageForFailure } from "@/lib/agent/errorTaxonomy";
import {
  summarizeEvidenceCard,
  type EvidenceCard,
} from "@/lib/agent/evidenceCard";

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
          ? "border-buy/35 bg-buy/[0.06]"
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
        <p className="mt-1.5 text-warning">
          {t("agent.evidence.not_execution_grade")}
        </p>
      ) : null}
    </div>
  );
}

export function AgentPresentationFacts({
  envelope,
}: {
  envelope?: ResultEnvelope | null;
}) {
  const { t } = useLocale();
  // The data source row is gone on operator instruction: provenance is
  // internal and never user-facing. Old envelopes may still carry
  // market_data_source; it is deliberately not rendered.
  if (!envelope?.key_price_levels?.length) {
    return null;
  }
  return (
    <div
      data-testid="agent-presentation-facts"
      className="mb-2 rounded-md border border-border/60 bg-muted/25 px-2.5 py-2 text-[11px] text-muted-foreground"
    >
      <p className="mt-1 tabular-nums" dir="ltr">
        <span className="font-semibold text-foreground/90">{t("agent.levels_label")}: </span>
        {envelope.key_price_levels.slice(0, 6).map((l) => l.toFixed(2)).join(", ")}
      </p>
    </div>
  );
}

export function AgentFaultCard({ envelope }: { envelope: ResultEnvelope }) {
  const { t, locale } = useLocale();
  // The envelope already carries which stage stalled — the server records it in
  // the audit row and has done all along. Deriving the sentence from the
  // failure CODE alone threw that away, so the operator read "took longer than
  // allowed" for a run the server knew had blocked on market data.
  const stages =
    envelope.degraded_stages?.length
      ? envelope.degraded_stages
      : envelope.failure_stage
        ? [envelope.failure_stage]
        : [];
  const reason = userMessageForFailure(envelope.failure_code ?? "unknown", locale, {
    stages,
    // A provider fault names its provider here too — the same sentence the
    // server logged, not a vaguer client-side paraphrase of it.
    provider:
      envelope.failure_provider === "openai" || envelope.failure_provider === "anthropic"
        ? envelope.failure_provider
        : null,
  });
  const retryHint = envelope.retryable
    ? t("agent.fault.retryable")
    : t("agent.fault.permanent");
  return (
    <div className="mt-1 rounded-lg border border-destructive/40 bg-destructive/[0.06] px-3 py-2 text-[12px]">
      <div className="flex items-center gap-1.5 font-semibold text-destructive">
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
