"use client";

/**
 * Honest label for the bot surface: per-bot mode + linked account type.
 *
 * Replaces the permanent "simulation only" banner. The account type comes
 * from the broker-reported `account_trade_mode` — the same signal
 * `executeIntent` uses — so the trader cannot discover after the fact that
 * they were on the wrong account.
 */
import { FlaskConical, Radio } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import {
  AccountTypeBadge,
  type AccountType,
} from "@/components/agent/AccountTypeBadge";
import { cn } from "@/lib/utils";
import type { QuantBotExecutionMode } from "@/lib/quantAgent/bots/brokerPort";

export function BotStatusBanner({
  executionMode,
  accountType,
  className,
}: {
  executionMode?: QuantBotExecutionMode;
  accountType: AccountType;
  className?: string;
}) {
  const { t, dir } = useLocale();
  const mode = executionMode ?? "simulation";
  const live = mode === "live";
  const Icon = live ? Radio : FlaskConical;

  return (
    <div
      dir={dir}
      role="note"
      data-testid="bot-status-banner"
      data-execution-mode={mode}
      data-account-type={accountType ?? "unknown"}
      className={cn(
        "flex items-start gap-2 rounded-xl border p-3",
        live
          ? "border-warning/45 bg-warning/10"
          : "border-info/40 bg-info/10",
        className,
      )}
    >
      <Icon
        className={cn(
          "mt-0.5 h-4 w-4 shrink-0",
          live ? "text-warning" : "text-info",
        )}
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <p
            className={cn(
              "text-sm font-semibold",
              live ? "text-warning" : "text-info",
            )}
          >
            {live
              ? t("qa.bots.status.live_title")
              : t("qa.bots.status.simulation_title")}
          </p>
          <AccountTypeBadge type={accountType} />
        </div>
        <p className="text-[12px] text-muted-foreground">
          {live
            ? t("qa.bots.status.live_body")
            : t("qa.bots.status.simulation_body")}
        </p>
      </div>
    </div>
  );
}

/** Compact per-bot mode chip for list rows and ladder headers. */
export function BotModeBadge({
  mode,
  className,
}: {
  mode: QuantBotExecutionMode;
  className?: string;
}) {
  const { t } = useLocale();
  const live = mode === "live";
  const Icon = live ? Radio : FlaskConical;
  return (
    <span
      data-testid="bot-mode-badge"
      data-execution-mode={mode}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
        live
          ? "border-warning/45 bg-warning/10 text-warning"
          : "border-info/40 bg-info/10 text-info",
        className,
      )}
    >
      <Icon className="h-3 w-3" aria-hidden="true" />
      {live ? t("qa.bots.status.live_badge") : t("qa.bots.status.simulation_badge")}
    </span>
  );
}

/** @deprecated Use BotStatusBanner — kept as an alias during the rename. */
export const SimulationOnlyBanner = BotStatusBanner;
/** @deprecated Use BotModeBadge. */
export function SimulationOnlyBadge({ className }: { className?: string }) {
  return <BotModeBadge mode="simulation" className={className} />;
}
