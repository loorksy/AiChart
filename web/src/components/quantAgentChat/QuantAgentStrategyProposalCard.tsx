"use client";

/**
 * Strategy proposal artifact (plan §4/§5) — no Lonora equivalent. Rendered
 * inline in the message flow when `generate_strategy` succeeds: a decision-
 * card summary of what the LLM drafted and the platform already validated
 * and persisted disabled. Two render modes, discriminated on
 * `proposal.mode`: `"sandboxed_code"` (now the chat intent's default) shows
 * the generated Python via the shared `CodeBlock`; `"declarative"` (the DSL
 * path, kept as an alternative mechanism) shows the condition-tree text
 * summary. "Enable this strategy" is the only path that makes it live — this
 * component never invents or edits a number, it only displays what the
 * server already stored.
 */
import { useState } from "react";
import { ArrowDownRight, ArrowUpRight, CheckCircle2, XCircle } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { Surface } from "@/components/foundation";
import { Button } from "@/components/squareui/button";
import { cn } from "@/lib/utils";
import type { QuantBacktestMetrics, QuantConditionLeaf, QuantConditionNode } from "@/lib/quantAgent/types";
import type { QuantAgentStrategyProposal } from "@/lib/agent/quantAgentChat/types";
import { formatNumber } from "@/components/quantAgent/QuantRecommendationCard";
import { CodeBlock } from "./CodeBlock";

/**
 * Mirrors the confirmed quality-gate thresholds enforced server-side in the
 * orchestrator's bounded backtest loop (min 30 resolved trades, profit
 * factor >= 1.2, max drawdown <= 40% — see `orchestrator.ts`'s
 * `passesBacktestQualityGate`). Display-only: it decides nothing new — the
 * pass/fail outcome was already computed when the loop ran; this only
 * re-derives the same badge from the same numbers for rendering. `null`
 * metrics never pass, matching the loop's own explicit rule.
 */
function passesBacktestQualityGate(metrics: QuantBacktestMetrics | null): boolean {
  if (!metrics) return false;
  if (metrics.tradeCount < 30) return false;
  if (metrics.profitFactor == null || metrics.profitFactor < 1.2) return false;
  if (metrics.maxDrawdownPercent == null || metrics.maxDrawdownPercent > 40) return false;
  return true;
}

export type QuantAgentStrategyProposalCardProps = {
  proposal: QuantAgentStrategyProposal;
};

function describeLeaf(leaf: QuantConditionLeaf): string {
  switch (leaf.type) {
    case "ema_relation":
      return `EMA${String(leaf.fast_period ?? "?")} ${leaf.relation === "below" ? "<" : ">"} EMA${String(leaf.slow_period ?? "?")}`;
    case "rsi_threshold":
      return `RSI(${String(leaf.period ?? "?")}) ${leaf.operator === "below" ? "<" : ">"} ${String(leaf.value ?? "?")}`;
    case "macd":
      return `MACD ${String(leaf.signal ?? "").replace(/_/g, " ")}`;
    case "bollinger_touch":
      return `Bollinger(${String(leaf.period ?? "?")}) ${String(leaf.band ?? "?")} touch`;
    case "adx_threshold":
      return `ADX(${String(leaf.period ?? "?")}) ${leaf.operator === "below" ? "<" : ">"} ${String(leaf.value ?? "?")}`;
    case "regime":
      return `regime = ${String(leaf.value ?? "?")}`;
    default:
      return "condition";
  }
}

function isLeaf(node: QuantConditionNode | QuantConditionLeaf): node is QuantConditionLeaf {
  return "type" in node;
}

function describeNode(node: QuantConditionNode | QuantConditionLeaf | undefined): string {
  if (!node) return "";
  if (isLeaf(node)) return describeLeaf(node);
  if (node.all?.length) return `ALL(${node.all.map((n) => describeNode(n)).join("; ")})`;
  if (node.any?.length) return `ANY(${node.any.map((n) => describeNode(n)).join("; ")})`;
  if (node.not) return `NOT(${describeNode(node.not)})`;
  return "";
}

export function QuantAgentStrategyProposalCard({ proposal }: QuantAgentStrategyProposalCardProps) {
  const { t, dir } = useLocale();
  const [dismissed, setDismissed] = useState(false);
  const [enabling, setEnabling] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [enableError, setEnableError] = useState(false);

  if (dismissed) return null;

  if (proposal.status === "invalid") {
    return (
      <Surface padding="sm" className="mt-2 border-destructive/30">
        <div dir={dir} className="flex items-start gap-2">
          <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-foreground">{t("qa.chat.strategy.invalid_title")}</p>
            {proposal.errors.length ? (
              <ul className="mt-1 space-y-0.5 text-[12px] text-muted-foreground">
                {proposal.errors.slice(0, 6).map((e, i) => (
                  <li key={`${e.path}-${i}`}>
                    <span className="font-mono text-[11px] text-foreground/70">{e.path}</span>: {e.message}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
      </Surface>
    );
  }

  const { strategy } = proposal;
  const strategyId = strategy.id ?? strategy.strategy_id;
  const isCodeMode = proposal.mode === "sandboxed_code";
  const displayName = isCodeMode ? strategy.display_name : proposal.spec.display_name;
  const description = isCodeMode
    ? typeof strategy.description === "string"
      ? strategy.description
      : undefined
    : proposal.spec.description;
  const regimeAffinity: string[] = isCodeMode
    ? typeof strategy.regime_affinity === "string" && strategy.regime_affinity
      ? [strategy.regime_affinity]
      : []
    : (proposal.spec.regime_affinity ?? []);
  const direction = isCodeMode ? undefined : proposal.spec.direction;

  async function handleEnable() {
    setEnabling(true);
    setEnableError(false);
    try {
      const res = await fetch(`/api/quant-agent/strategies/${encodeURIComponent(strategyId)}/enable`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: true }),
      });
      if (!res.ok) throw new Error("enable failed");
      setEnabled(true);
    } catch {
      setEnableError(true);
    } finally {
      setEnabling(false);
    }
  }

  return (
    <Surface padding="sm" className="mt-2">
      <div dir={dir} className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          {direction ? (
            <span
              className={cn(
                "inline-flex items-center gap-1 text-sm font-bold",
                direction === "buy" ? "text-buy" : "text-sell",
              )}
            >
              {direction === "buy" ? (
                <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
              ) : (
                <ArrowDownRight className="h-4 w-4" aria-hidden="true" />
              )}
              {t(`decision.${direction}`)}
            </span>
          ) : null}
          <span className="text-sm font-semibold text-foreground">{displayName}</span>
          {isCodeMode ? (
            <span className="rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[11px] text-foreground">
              {t("qa.chat.strategy.sandboxed_code_badge")}
            </span>
          ) : null}
          {regimeAffinity.map((regime) => (
            <span
              key={regime}
              className="rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[11px] text-foreground"
            >
              {regime}
            </span>
          ))}
          <span className="ms-auto rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-[11px] font-medium text-warning">
            {t("qa.chat.strategy.disabled_badge")}
          </span>
        </div>

        {description ? <p className="text-[12px] text-muted-foreground">{description}</p> : null}

        {isCodeMode ? (
          <CodeBlock language="python" code={proposal.code} />
        ) : (
          <>
            <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2 font-mono text-[11px] text-foreground/80">
              {describeNode(proposal.spec.entry_conditions) || t("qa.chat.strategy.no_conditions")}
            </div>

            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-[12px] sm:grid-cols-3">
              <div>
                <dt className="text-[11px] text-muted-foreground">{t("qa.chat.strategy.stop")}</dt>
                <dd className="font-mono text-foreground">{proposal.spec.stop_loss_atr_multiple}× ATR</dd>
              </div>
              <div>
                <dt className="text-[11px] text-muted-foreground">{t("qa.chat.strategy.targets")}</dt>
                <dd className="font-mono text-foreground">{proposal.spec.take_profit_r_multiples.join(", ")}R</dd>
              </div>
            </dl>
          </>
        )}

        {proposal.backtest ? (
          <div className="space-y-1.5 rounded-lg border border-border/60 bg-muted/20 px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold text-foreground">
                {t("qa.chat.strategy.backtest.title")}
              </span>
              {proposal.backtest.status === "completed" ? (
                <span
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
                    passesBacktestQualityGate(proposal.backtest.metrics)
                      ? "border-success/45 bg-success/10 text-success"
                      : "border-warning/40 bg-warning/10 text-warning",
                  )}
                >
                  {passesBacktestQualityGate(proposal.backtest.metrics) ? (
                    <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                  ) : (
                    <XCircle className="h-3 w-3" aria-hidden="true" />
                  )}
                  {t(
                    passesBacktestQualityGate(proposal.backtest.metrics)
                      ? "qa.chat.strategy.backtest.pass_badge"
                      : "qa.chat.strategy.backtest.fail_badge",
                  )}
                </span>
              ) : (
                <span className="text-[11px] text-muted-foreground">
                  {t("qa.chat.strategy.backtest.unavailable")}
                </span>
              )}
            </div>
            {proposal.backtest.metrics ? (
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-[12px] sm:grid-cols-4">
                <div>
                  <dt className="text-[11px] text-muted-foreground">{t("qa.chat.strategy.backtest.trades")}</dt>
                  <dd className="font-mono text-foreground">{formatNumber(proposal.backtest.metrics.tradeCount)}</dd>
                </div>
                <div>
                  <dt className="text-[11px] text-muted-foreground">{t("qa.chat.strategy.backtest.win_rate")}</dt>
                  <dd className="font-mono text-foreground">{formatNumber(proposal.backtest.metrics.winRate)}</dd>
                </div>
                <div>
                  <dt className="text-[11px] text-muted-foreground">
                    {t("qa.chat.strategy.backtest.profit_factor")}
                  </dt>
                  <dd className="font-mono text-foreground">
                    {formatNumber(proposal.backtest.metrics.profitFactor)}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] text-muted-foreground">
                    {t("qa.chat.strategy.backtest.max_drawdown")}
                  </dt>
                  <dd className="font-mono text-foreground">
                    {formatNumber(proposal.backtest.metrics.maxDrawdownPercent)}
                  </dd>
                </div>
              </dl>
            ) : null}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2 pt-1">
          {enabled ? (
            <span className="inline-flex items-center gap-1 text-[12px] font-medium text-buy">
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
              {t("qa.chat.strategy.enabled_confirm")}
            </span>
          ) : (
            <Button variant="default" size="sm" disabled={enabling} onClick={() => void handleEnable()}>
              {enabling ? t("qa.chat.strategy.enabling") : t("qa.chat.strategy.enable_cta")}
            </Button>
          )}
          {!enabled ? (
            <Button variant="outline" size="sm" onClick={() => setDismissed(true)}>
              {t("qa.chat.strategy.dismiss")}
            </Button>
          ) : null}
          {enableError ? (
            <span className="text-[12px] text-destructive">{t("qa.chat.strategy.enable_error")}</span>
          ) : null}
        </div>
      </div>
    </Surface>
  );
}
