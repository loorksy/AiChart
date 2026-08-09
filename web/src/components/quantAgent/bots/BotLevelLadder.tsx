"use client";

/**
 * The level ladder a bot configuration would arm, plus the warnings and risk
 * diagnostics it earns.
 *
 * SIMULATION ONLY — nothing rendered here is a resting order anywhere.
 *
 * Ported from QuantDinger (https://github.com/OpenByteInc/QuantDinger),
 * Copyright Open Byte Inc., licensed under the Apache License, Version 2.0
 * — `quantdinger-vue/src/views/executor-strategies/index.vue`'s preview pane
 * (its `Level / Layer / Order / Action / Side / Price / Quote amount / Take
 * profit price / Trailing activation price / Trigger` table and the
 * `Levels / Total amount / First price / Last price` summary tiles).
 *
 * What changed: the desktop ten-column table is a five-column one, because
 * this console is mobile-first and a ten-column table at 360px is a
 * horizontal scrollbar pretending to be a layout. Layer/order are folded into
 * the level cell, side into the action cell, and the trailing-activation
 * column is dropped (it repeats the take-profit column whenever trailing is
 * off, which is the default here). The table still scrolls inside its own
 * container so the page body never does — `web/DESIGN.md` §8.
 */
import { AlertTriangle } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { Surface } from "@/components/foundation";
import type {
  QuantBotLevel,
  QuantBotPreviewSummary,
  QuantBotRiskDiagnostic,
} from "@/lib/quantAgent/bots/types";
import { BotModeBadge } from "./BotStatusBanner";

/** Prices and sizes vary by orders of magnitude across symbols and budgets. */
function formatAmount(value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (value === 0) return "0";
  const abs = Math.abs(value);
  if (abs >= 1000) return value.toFixed(0);
  if (abs >= 1) return value.toFixed(2);
  return value.toFixed(6);
}

function formatPct(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(2)}%`;
}

export function BotLevelLadder({
  levels,
  summary,
  warnings,
  diagnostics,
  blockingWarning,
}: {
  levels: QuantBotLevel[];
  summary: QuantBotPreviewSummary | null;
  warnings: string[];
  diagnostics: QuantBotRiskDiagnostic[];
  blockingWarning: string;
}) {
  const { t, dir } = useLocale();

  return (
    <Surface padding="sm">
      <div dir={dir} className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold text-foreground">{t("qa.bots.preview.heading")}</h2>
          {blockingWarning ? (
            <span className="rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-[11px] font-medium text-warning">
              {t("qa.bots.preview.blocked")}
            </span>
          ) : null}
          {/* These prices are levels a replay would arm, not resting orders. */}
          <BotModeBadge mode="simulation" className="ms-auto" />
        </div>

        {warnings.length > 0 ? (
          <ul className="space-y-1">
            {warnings.map((warning) => (
              <li key={warning} className="flex items-start gap-1.5 text-[12px] text-warning">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                {/*
                  Falls back to the raw code when a new upstream warning has no
                  key yet: an untranslated code the user can search for beats a
                  blank line that hides the problem.
                */}
                <span>{t(`qa.bots.warning.${warning}`)}</span>
              </li>
            ))}
          </ul>
        ) : null}

        {summary ? (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-[12px] sm:grid-cols-4">
            <div className="min-w-0">
              <dt className="text-[11px] text-muted-foreground">{t("qa.bots.preview.count")}</dt>
              <dd className="font-mono text-foreground">{summary.levelCount}</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-[11px] text-muted-foreground">{t("qa.bots.preview.total")}</dt>
              <dd dir="ltr" className="truncate font-mono text-foreground">
                {formatAmount(summary.totalAmountQuote)}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-[11px] text-muted-foreground">
                {t("qa.bots.preview.first_price")}
              </dt>
              <dd dir="ltr" className="truncate font-mono text-foreground">
                {formatAmount(summary.firstPrice)}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-[11px] text-muted-foreground">
                {t("qa.bots.preview.last_price")}
              </dt>
              <dd dir="ltr" className="truncate font-mono text-foreground">
                {formatAmount(summary.lastPrice)}
              </dd>
            </div>
          </dl>
        ) : null}

        {levels.length === 0 ? (
          <p className="text-[12px] text-muted-foreground">{t("qa.bots.preview.empty")}</p>
        ) : (
          // Wide content scrolls inside its own container; the body never does.
          <div className="-mx-1 overflow-x-auto px-1">
            <table className="w-full min-w-[22rem] border-collapse text-[12px]">
              <thead>
                <tr className="border-b border-border text-start text-[11px] text-muted-foreground">
                  <th scope="col" className="py-1 pe-2 text-start font-normal">
                    {t("qa.bots.preview.level")}
                  </th>
                  <th scope="col" className="py-1 pe-2 text-start font-normal">
                    {t("qa.bots.preview.action")}
                  </th>
                  <th scope="col" className="py-1 pe-2 text-end font-normal">
                    {t("qa.bots.preview.price")}
                  </th>
                  <th scope="col" className="py-1 pe-2 text-end font-normal">
                    {t("qa.bots.preview.amount")}
                  </th>
                  <th scope="col" className="py-1 text-end font-normal">
                    {t("qa.bots.preview.take_profit")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {levels.map((level) => (
                  <tr key={`${level.level}-${level.price}`} className="border-b border-border/40">
                    <td className="py-1 pe-2 font-mono text-foreground/80">
                      {level.layerIndex > 1 || level.orderIndex > 1
                        ? `${level.level} · ${level.layerIndex}.${level.orderIndex}`
                        : level.level}
                    </td>
                    <td className="py-1 pe-2">
                      <span
                        className={
                          level.side === "short" ? "text-sell" : "text-buy"
                        }
                      >
                        {level.action}
                      </span>
                    </td>
                    <td dir="ltr" className="py-1 pe-2 text-end font-mono text-foreground">
                      {formatAmount(level.price)}
                    </td>
                    <td dir="ltr" className="py-1 pe-2 text-end font-mono text-foreground/80">
                      {formatAmount(level.amountQuote)}
                    </td>
                    <td dir="ltr" className="py-1 text-end font-mono text-foreground/80">
                      {level.takeProfitPrice > 0 ? formatAmount(level.takeProfitPrice) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {diagnostics.length > 0 ? (
          <div className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2">
            <p className="text-[11px] font-medium text-warning">
              {t("qa.bots.diagnostic.heading")}
            </p>
            <ul className="mt-1 space-y-0.5">
              {diagnostics.map((item) => (
                <li key={item.beforeLevel} className="text-[11px] text-foreground/80">
                  {t("qa.bots.diagnostic.before_level", { level: String(item.beforeLevel) })}
                  <span className="ms-2 font-mono text-muted-foreground">
                    {t("qa.bots.diagnostic.suggested", {
                      pct: (item.suggestedStopPct * 100).toFixed(2),
                    })}
                  </span>
                  <span className="ms-2 font-mono text-muted-foreground" dir="ltr">
                    {formatPct(item.configuredStopPct)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </Surface>
  );
}
