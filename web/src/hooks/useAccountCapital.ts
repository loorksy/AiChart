"use client";

import { useCallback, useEffect, useState } from "react";

export interface AccountCapitalState {
  loading: boolean;
  connected: boolean;
  label: string | null;
  amount: number | null;
  currency: string;
}

const EMPTY: AccountCapitalState = {
  loading: true,
  connected: false,
  label: null,
  amount: null,
  currency: "USD",
};

/** Live MT5 equity/balance for the connected forex account. */
export function useAccountCapital(_market?: "forex") {
  const [state, setState] = useState<AccountCapitalState>(EMPTY);

  const refresh = useCallback(async () => {
    setState((s) => ({ ...s, loading: true }));
    try {
      const statusRes = await fetch("/api/console/status", { cache: "no-store" });
      if (!statusRes.ok) {
        setState({ ...EMPTY, loading: false });
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

      const equity = mt.equity ?? mt.balance ?? null;
      setState({
        loading: false,
        connected: Boolean(status.mt5?.online ?? mt.online),
        label: "MetaTrader",
        amount: equity != null && equity > 0 ? equity : null,
        currency: mt.currency ?? "USD",
      });
    } catch {
      setState({ ...EMPTY, loading: false });
    }
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 60_000);
    return () => clearInterval(t);
  }, [refresh]);

  return { ...state, refresh };
}
