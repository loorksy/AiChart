"use client";

import Link from "next/link";
import { AlertTriangle, Loader2, Wallet } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { useBillingSummary } from "@/hooks/useBillingSummary";
import { cn } from "@/lib/utils";
import { isNumericReady, type NumericFetchState } from "@/lib/display/numericDisplay";

/**
 * The CREDIT balance in the header — billing v3. Always shown when the
 * summary API succeeds, including while billing enforcement is off (owner
 * policy). Free accounts read their trial count here; Pro accounts read the
 * credit number, with the LOW state driven by the ADMIN threshold (a
 * database number, never a constant). Updates instantly via the shared
 * billing-changed feed — no reloads.
 */
export function BalanceChip() {
  const { t } = useLocale();
  const { summary } = useBillingSummary();

  if (!summary) {
    return (
      <span
        data-testid="balance-chip"
        data-balance-state="loading"
        className="flex min-h-9 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs text-muted-foreground"
        aria-busy="true"
      >
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden />
        <span className="hidden sm:inline text-[10px] font-medium opacity-70">
          {t("balance.credit_short")}
        </span>
        <span dir="ltr">{t("balance.loading")}</span>
      </span>
    );
  }

  const pro = summary.status === "pro";
  const empty = pro && summary.balance <= 0;
  const low = pro && !empty && summary.alerts.low_balance;

  return (
    <Link
      href="/console/billing"
      data-testid="balance-chip"
      data-balance-state={empty ? "empty" : low ? "low" : "ok"}
      className={cn(
        "flex min-h-9 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs font-semibold tabular-nums transition-colors duration-150 ease-out",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        empty
          ? "bg-destructive/15 text-destructive hover:bg-destructive/25"
          : low
            ? "bg-warning/15 text-warning hover:bg-warning/25"
            : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
      title={t("balance.credit_short")}
    >
      {empty || low ? (
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
      ) : (
        <Wallet className="h-3.5 w-3.5 shrink-0" aria-hidden />
      )}
      <span className="hidden sm:inline text-[10px] font-medium opacity-70">
        {pro ? t("balance.credit_short") : t("account.badge.free")}
      </span>
      {/* ONE currency, so one number — for a Free account exactly as much as
          for a subscriber. This used to draw the trial counters for a Free
          account, and those fields stopped existing when the trial became a
          credit grant: the chip rendered two `undefined`s around a slash, so
          the operator saw "Free" and a bare "/" where their 50 credits should
          have been. */}
      <span dir="ltr">{summary.balance}</span>
      {(empty || low) && (
        <span className="hidden sm:inline">
          {empty ? t("balance.add_credit") : t("balance.low")}
        </span>
      )}
    </Link>
  );
}

/** Exported for unit tests — maps the summary payload to display state. */
export function balanceChipStateFromApi(json: {
  ok: boolean;
  balance?: number;
}): NumericFetchState {
  if (!json.ok || !isNumericReady(json.balance)) {
    return { status: "error" };
  }
  return { status: "ready", value: json.balance! };
}
