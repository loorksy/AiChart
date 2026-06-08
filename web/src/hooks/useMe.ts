"use client";

import { useCallback, useEffect, useState } from "react";
import type { AdminLimits, BinanceAccountMeta, PublicUser } from "@/lib/types";
import { displayNameFromEmail } from "@/lib/displayName";

export interface QuotaInfo {
  used: number;
  limit: number;
  remaining: number;
}

export interface MeData {
  user: PublicUser;
  settings: { telegram_chat_id: string | null };
  limits: AdminLimits;
  binance: BinanceAccountMeta | null;
  quota: QuotaInfo;
  displayName: string;
}

export function useMe(refreshKey = 0) {
  const [data, setData] = useState<MeData | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/me");
      if (res.status === 401) {
        setData(null);
        return;
      }
      const json = await res.json();
      if (!json.user) {
        setData(null);
        return;
      }
      const used = json.quota?.used ?? 0;
      const limit = json.quota?.limit ?? json.limits?.claude_quota ?? 0;
      const remaining = Math.max(0, limit - used);
      setData({
        user: json.user,
        settings: json.settings,
        limits: json.limits,
        binance: json.binance,
        quota: { used, limit, remaining },
        displayName: displayNameFromEmail(json.user.email),
      });
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh, refreshKey]);

  return { data, loading, refresh };
}
