"use client";

/**
 * What one simulated run produced.
 *
 * SIMULATION ONLY, and every number on this card says so by construction: they
 * come from `SimulatedQuantBroker` filling limit orders against historical
 * candles. No P&L here was ever realised anywhere.
 *
 * Directional tokens are used for what they mean: `text-buy` / `text-sell` for
 * P&L sign, per `web/DESIGN.md` §2 ("P&L and price text route through
 * text-buy/text-sell"). Fees are never coloured — a cost is not a direction.
 */
import { useLocale } from "@/hooks/useLocale";
import { Surface } from "@/components/foundation";
import { cn } from "@/lib/utils";
import type { QuantBotRun } from "@/lib/quantAgent/bots/types";
import { SimulationOnlyBadge } from "./SimulationOnlyBanner";

function formatMoney(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return value.toFixed(2);
}

function signedClass(value: number): string {
  if (!Number.isFinite(value) || value === 0) return "text-foreground";
  return value > 0 ? "text-buy" : "text-sell";
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd dir="ltr" className={cn("truncate font-mono text-sm", tone ?? "text-foreground")}>
        {value}
      </dd>
    </div>
  );
}

export function BotRunSummary({ run }: { run: QuantBotRun }) {
  const { t, dir } = useLocale();

  return (
    <Surface padding="sm">
      <div dir={dir} className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold text-foreground">{t("qa.bots.run.heading")}</h2>
          <SimulationOnlyBadge className="ms-auto" />
        </div>

        {run.status === "invalid" ? (
          <p className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-[12px] text-warning">
            {run.error ?? t("qa.bots.run.invalid")}
          </p>
        ) : null}

        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
          <Metric label={t("qa.bots.run.bars")} value={String(run.barCount)} />
          <Metric label={t("qa.bots.run.fills")} value={String(run.fillCount)} />
          <Metric label={t("qa.bots.run.cycles")} value={String(run.matchedCycles)} />
          <Metric label={t("qa.bots.run.resting")} value={String(run.restingOrders)} />
          <Metric
            label={t("qa.bots.run.realized")}
            value={formatMoney(run.realizedProfit)}
            tone={signedClass(run.realizedProfit)}
          />
          <Metric
            label={t("qa.bots.run.unrealized")}
            value={formatMoney(run.unrealizedProfit)}
            tone={signedClass(run.unrealizedProfit)}
          />
          {/* A cost, not a direction — never tinted buy/sell. */}
          <Metric
            label={t("qa.bots.run.commission")}
            value={formatMoney(run.totalCommission)}
            tone="text-muted-foreground"
          />
          <Metric label={t("qa.bots.run.ending_price")} value={formatMoney(run.endingPrice)} />
        </dl>

        {run.stopReason ? (
          <p className="text-[12px] text-warning">
            {t("qa.bots.run.stopped", { reason: run.stopReason })}
          </p>
        ) : null}

        {run.warnings.length > 0 ? (
          <ul className="space-y-0.5">
            {run.warnings.map((warning) => (
              <li key={warning} className="text-[11px] text-muted-foreground">
                {warning}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </Surface>
  );
}
