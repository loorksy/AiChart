"use client";

import { FlaskConical, Wallet } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { cn } from "@/lib/utils";

export type AccountType = "demo" | "live" | null;

/**
 * Demo or real, said out loud wherever the connected account appears.
 *
 * Every connected account is accepted — a trader spending their first month on
 * a demo account is the normal way to start here, not a lesser state. What must
 * never be ambiguous is WHICH account the numbers on screen belong to, so the
 * badge is calm and factual for demo and deliberately louder for real money.
 *
 * `null` is its own answer: the broker has not reported a type, and saying
 * "unknown" is honest where guessing "demo" would be dangerous.
 */
export function AccountTypeBadge({
  type,
  className,
  size = "sm",
}: {
  type: AccountType;
  className?: string;
  size?: "sm" | "md";
}) {
  const { t } = useLocale();
  const label =
    type === "live"
      ? t("account.type.live")
      : type === "demo"
        ? t("account.type.demo")
        : t("account.type.unknown");

  const Icon = type === "live" ? Wallet : FlaskConical;

  return (
    <span
      data-testid="account-type-badge"
      data-account-type={type ?? "unknown"}
      title={label}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full border font-semibold",
        size === "md" ? "px-2.5 py-1 text-xs" : "px-2 py-0.5 text-[11px]",
        type === "live"
          ? "border-warning/45 bg-warning/10 text-warning"
          : type === "demo"
            ? "border-info/40 bg-info/10 text-info"
            : "border-border bg-muted/40 text-muted-foreground",
        className,
      )}
    >
      <Icon className={size === "md" ? "h-3.5 w-3.5" : "h-3 w-3"} aria-hidden />
      {label}
    </span>
  );
}

/** Normalizes whatever a backend reported into the badge's three states. */
export function toAccountType(raw: string | null | undefined): AccountType {
  const value = (raw ?? "").toLowerCase().replace(/^account_trade_mode_/, "").trim();
  if (value === "real" || value === "live") return "live";
  // A contest account is not real money; it belongs with demo for the trader.
  if (value === "demo" || value === "contest") return "demo";
  return null;
}
