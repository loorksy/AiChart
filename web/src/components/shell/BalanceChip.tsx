"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Wallet } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { cn } from "@/lib/utils";

/** Below this the account is running on fumes and the next analysis may fail. */
const LOW_BALANCE_USD = 2;

type BalanceState = {
  totalUsd: number;
  enforced: boolean;
};

/**
 * The account's fuel gauge, in the header where the account lives.
 *
 * Money state was only discoverable by opening the billing page — the first
 * sign of an empty balance was an analysis refusing to run. The chip keeps the
 * figure in view and turns into a call to action at the two moments that need
 * one: empty (add credit or nothing runs) and nearly empty (add credit before
 * it interrupts you). In between it is just a number, not a nag.
 */
export function BalanceChip() {
  const { t } = useLocale();
  const [state, setState] = useState<BalanceState | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch("/api/billing/balance", { cache: "no-store" });
        if (!res.ok) return;
        const json = (await res.json()) as {
          ok: boolean;
          billing_enforced: boolean;
          balance?: { totalUsd?: number };
        };
        if (alive && json.ok && typeof json.balance?.totalUsd === "number") {
          setState({ totalUsd: json.balance.totalUsd, enforced: json.billing_enforced });
        }
      } catch {
        /* header stays quiet on failure — billing page remains the source */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Nothing sensible to show before the figure arrives, and while billing is
  // in preview mode the number would imply a constraint that is not enforced.
  if (!state || !state.enforced) return null;

  const empty = state.totalUsd <= 0;
  const low = !empty && state.totalUsd < LOW_BALANCE_USD;

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
    >
      {empty || low ? (
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
      ) : (
        <Wallet className="h-3.5 w-3.5 shrink-0" aria-hidden />
      )}
      <span className="hidden sm:inline text-[10px] font-medium opacity-70">
        {t("balance.credit_short")}
      </span>
      <span dir="ltr">${state.totalUsd.toFixed(2)}</span>
      {(empty || low) && (
        <span className="hidden sm:inline">
          {empty ? t("balance.add_credit") : t("balance.low")}
        </span>
      )}
    </Link>
  );
}
