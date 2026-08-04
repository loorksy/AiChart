"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Loader2, Wallet } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { cn } from "@/lib/utils";
import {
  formatUsd,
  isNumericReady,
  type NumericFetchState,
} from "@/lib/display/numericDisplay";

/** Below this the account is running on fumes and the next analysis may fail. */
const LOW_BALANCE_USD = 2;

type ChipState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; totalUsd: number; enforced: boolean };

/**
 * Subscription credit in the header — always shown when the balance API
 * succeeds, including while billing enforcement is off (owner policy).
 */
export function BalanceChip() {
  const { t } = useLocale();
  const [state, setState] = useState<ChipState>({ status: "loading" });

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch("/api/billing/balance", { cache: "no-store" });
        if (!res.ok) {
          if (alive) setState({ status: "error" });
          return;
        }
        const json = (await res.json()) as {
          ok: boolean;
          billing_enforced: boolean;
          balance?: { totalUsd?: number };
        };
        if (!alive || !json.ok || !isNumericReady(json.balance?.totalUsd)) {
          if (alive) setState({ status: "error" });
          return;
        }
        setState({
          status: "ready",
          totalUsd: json.balance!.totalUsd!,
          enforced: json.billing_enforced,
        });
      } catch {
        if (alive) setState({ status: "error" });
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (state.status === "loading") {
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

  if (state.status === "error") {
    return (
      <Link
        href="/console/billing"
        data-testid="balance-chip"
        data-balance-state="error"
        className="flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border border-warning/40 bg-warning/10 px-2.5 text-xs font-semibold text-warning"
        title={t("balance.load_failed")}
      >
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className="hidden sm:inline text-[10px] font-medium opacity-80">
          {t("balance.credit_short")}
        </span>
        <span>{t("balance.unavailable")}</span>
      </Link>
    );
  }

  const empty = state.totalUsd <= 0;
  const low = !empty && state.totalUsd < LOW_BALANCE_USD;

  return (
    <Link
      href="/console/billing"
      data-testid="balance-chip"
      data-balance-state={empty ? "empty" : low ? "low" : "ok"}
      data-billing-enforced={state.enforced ? "true" : "false"}
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
        {t("balance.credit_short")}
      </span>
      <span dir="ltr">{formatUsd(state.totalUsd)}</span>
      {(empty || low) && (
        <span className="hidden sm:inline">
          {empty ? t("balance.add_credit") : t("balance.low")}
        </span>
      )}
    </Link>
  );
}

/** Exported for unit tests — maps API payload to display state. */
export function balanceChipStateFromApi(json: {
  ok: boolean;
  balance?: { totalUsd?: number };
}): NumericFetchState {
  if (!json.ok || !isNumericReady(json.balance?.totalUsd)) {
    return { status: "error" };
  }
  return { status: "ready", value: json.balance!.totalUsd! };
}
