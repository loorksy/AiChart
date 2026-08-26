"use client";

import { useLocale } from "@/hooks/useLocale";
import { useBillingSummary } from "@/hooks/useBillingSummary";
import { cn } from "@/lib/utils";

/**
 * The Free/Pro badge — visible on every page, readable WITHOUT color: the
 * state is spelled out as text (and exposed to screen readers); color only
 * reinforces it. A quiet dot marks a pending threshold alert (low balance /
 * expiring soon) — never a popup.
 */
export function AccountStatusBadge({ className }: { className?: string }) {
  const { t } = useLocale();
  const { summary } = useBillingSummary();
  if (!summary) return null;
  const pro = summary.status === "pro";
  const alert =
    summary.alerts.exhausted ||
    summary.alerts.low_balance ||
    summary.alerts.expiring_soon;

  return (
    <span
      data-testid="account-status-badge"
      className={cn(
        "relative inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold",
        pro
          ? "border-accent-gold/60 bg-accent-gold/10 text-foreground"
          : "border-border bg-muted/60 text-muted-foreground",
        className,
      )}
    >
      {pro ? t("account.badge.pro") : t("account.badge.free")}
      {alert && (
        <span
          className={cn(
            "absolute -end-0.5 -top-0.5 size-2 rounded-full",
            summary.alerts.exhausted ? "bg-destructive" : "bg-amber-500",
          )}
          aria-hidden="true"
        />
      )}
      {alert && (
        <span className="sr-only">
          {summary.alerts.exhausted
            ? t("account.alert.exhausted")
            : summary.alerts.low_balance
              ? t("account.alert.low_balance")
              : t("account.alert.expiring_soon")}
        </span>
      )}
    </span>
  );
}
