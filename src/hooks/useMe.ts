"use client";

import { useCallback, useEffect, useState } from "react";
import type { AdminLimits, PublicUser } from "@/lib/types";
import { displayNameFromEmail } from "@/lib/displayName";

export interface QuotaInfo {
  used: number;
  limit: number;
  remaining: number;
}

export interface EntitlementInfo {
  access: "admin" | "full" | "trial" | "blocked";
  planStatus: string;
  trialUsed: number;
  trialRemaining: number;
  trialLimit: number;
  expiresAt: string | null;
}

export interface MeData {
  /** Admin permission slugs; empty for non-admins and implicit owners. */
  admin_permissions?: string[];
  user: PublicUser;
  settings: { telegram_chat_id: string | null };
  limits: AdminLimits;
  quota: QuotaInfo;
  displayName: string;
  unreadAlerts: number;
  entitlement?: EntitlementInfo;
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
        quota: { used, limit, remaining },
        displayName: displayNameFromEmail(json.user.email),
        unreadAlerts: json.unreadAlerts ?? 0,
        entitlement: json.entitlement
          ? {
              access: json.entitlement.access,
              planStatus: json.entitlement.planStatus,
              trialUsed: json.entitlement.trialUsed ?? 0,
              trialRemaining: json.entitlement.trialRemaining ?? 0,
              trialLimit: json.entitlement.trialLimit ?? 3,
              expiresAt: json.entitlement.expiresAt ?? null,
            }
          : undefined,
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

  useEffect(() => {
    const id = window.setInterval(() => {
      void refresh();
    }, 60_000);
    return () => window.clearInterval(id);
  }, [refresh]);

  return { data, loading, refresh };
}
