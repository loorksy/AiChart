"use client";

import { useCallback, useEffect, useState } from "react";

export interface AccountCapitalState {
  loading: boolean;
  /** Fetch failed while MT is connected — distinct from a real $0 balance. */
  error: boolean;
  connected: boolean;
  label: string | null;
  /** Broker equity when known; `0` is valid. `null` only while loading / unknown. */
  amount: number | null;
  currency: string;
}

const EMPTY: AccountCapitalState = {
  loading: true,
  error: false,
  connected: false,
  label: null,
  amount: null,
  currency: "USD",
};

/** Live MT5 equity/balance for the connected forex account. */
export function useAccountCapital(_market?: "forex") {
  const [state, setState] = useState<AccountCapitalState>(EMPTY);

  const refresh = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: false }));
    try {
      const statusRes = await fetch("/api/console/status", { cache: "no-store" });
      if (!statusRes.ok) {
        setState({ ...EMPTY, loading: false, error: true });
        return;
      }
      const status = (await statusRes.json()) as {
        mt5?: { connected?: boolean; online?: boolean };
      };

      if (!status.mt5?.connected) {
        setState({ ...EMPTY, loading: false });
        return;
      }

      const mtRes = await fetch("/api/mt/status", { cache: "no-store" });
      if (!mtRes.ok) {
        setState({
          ...EMPTY,
          loading: false,
          error: true,
          connected: true,
          label: "MetaTrader",
        });
        return;
      }
      const mt = (await mtRes.json()) as {
        online?: boolean;
        balance?: number;
        equity?: number;
        currency?: string;
      };

      const rawEquity = mt.equity ?? mt.balance;
      const amount =
        typeof rawEquity === "number" && Number.isFinite(rawEquity)
          ? rawEquity
          : null;
      setState({
        loading: false,
        error: amount == null,
        connected: Boolean(status.mt5?.online ?? mt.online),
        label: "MetaTrader",
        amount,
        currency: mt.currency ?? "USD",
      });
    } catch {
      setState({ ...EMPTY, loading: false, error: true });
    }
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 60_000);
    return () => clearInterval(t);
  }, [refresh]);

  return { ...state, refresh };
}
