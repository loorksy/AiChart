"use client";

import { useCallback, useEffect, useState } from "react";
import type { AccountSummary } from "@/lib/billing/accountSummary";

/**
 * The live account-status feed for the badge and the account panel.
 *
 * Instant refresh without reloads: any flow that changes the account
 * (a completed turn, a purchase return, a broker link) calls
 * `notifyBillingChanged()`, and every mounted consumer refetches.
 */
/**
 * The view IS the server's own summary type — imported, not re-declared.
 *
 * It used to be a hand-written copy that still carried `trial_used`,
 * `trial_limit` and `trial_remaining` long after the server stopped sending
 * them (there is no trial any more: a Free account simply has a balance).
 * Because the copy declared them, TypeScript saw nothing wrong with reading
 * them — so the account menu rendered `String(undefined)` and shipped the
 * literal word "undefined" to the user, and the top bar drew an empty "/"
 * between two of them. A duplicated type is a type that stops checking.
 */
export type BillingSummaryView = AccountSummary;

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
