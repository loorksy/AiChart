"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * The live account-status feed for the badge and the account panel.
 *
 * Instant refresh without reloads: any flow that changes the account
 * (a completed turn, a purchase return, a broker link) calls
 * `notifyBillingChanged()`, and every mounted consumer refetches.
 */
export interface BillingSummaryView {
  status: "free" | "pro";
  plan_status: string;
  balance: number;
  trial_used: number;
  trial_limit: number;
  trial_remaining: number;
  expires_at: string | null;
  alerts: { low_balance: boolean; expiring_soon: boolean };
}

const EVENT = "lonora:billing-changed";

export function notifyBillingChanged(): void {
  try {
    window.dispatchEvent(new CustomEvent(EVENT));
  } catch {
    /* SSR / detached — nothing to refresh */
  }
}

export function useBillingSummary(): {
  summary: BillingSummaryView | null;
  refresh: () => void;
} {
  const [summary, setSummary] = useState<BillingSummaryView | null>(null);

  const refresh = useCallback(() => {
    fetch("/api/billing/summary")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: (BillingSummaryView & { ok: boolean }) | null) => {
        if (data?.ok) setSummary(data);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
    const onChange = () => refresh();
    window.addEventListener(EVENT, onChange);
    return () => window.removeEventListener(EVENT, onChange);
  }, [refresh]);

  return { summary, refresh };
}
