"use client";

import { useCallback, useEffect, useState } from "react";
import { Bot } from "lucide-react";
import { SurfaceCard } from "@/components/ui/shell";
import { cn } from "@/lib/utils";
import type { TradingMode } from "@/lib/types";

interface AgentStatus {
  bridgeConfigured: boolean;
  lastSeen: string | null;
  mode: TradingMode;
  canAuto: boolean;
  openTrades: number;
  todayPnlUsd: number;
}

const MODE_LABEL: Record<TradingMode, string> = {
  auto: "تلقائي",
  approval: "موافقة يدوية",
  direct: "مباشر",
};

/** Agent considered alive when the bridge was called within the last 40 min. */
const ALIVE_WINDOW_MS = 40 * 60 * 1000;

function pulseState(status: AgentStatus | null): {
  color: string;
  label: string;
} {
  if (!status) return { color: "bg-muted-foreground", label: "…" };
  if (!status.bridgeConfigured) {
    return { color: "bg-muted-foreground", label: "الجسر غير مفعّل" };
  }
  if (!status.lastSeen) {
    return { color: "bg-accent-gold", label: "لم يتصل الوكيل بعد" };
  }
  const ageMs = Date.now() - new Date(status.lastSeen).getTime();
  if (ageMs <= ALIVE_WINDOW_MS) {
    const mins = Math.max(0, Math.round(ageMs / 60_000));
    return {
      color: "bg-chart-1",
      label: mins <= 1 ? "نشط الآن" : `آخر نبضة قبل ${mins} د`,
    };
  }
  return {
    color: "bg-destructive",
    label: `منقطع منذ ${Math.round(ageMs / 3_600_000)} س`,
  };
}

export function AgentStatusBar({ className }: { className?: string }) {
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/agent-status", { cache: "no-store" });
      if (res.ok) setStatus((await res.json()) as AgentStatus);
    } catch {
      /* keep last state */
    }
  }, []);

  useEffect(() => {
    // Async polling of external server state — setState runs post-fetch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
    const t = setInterval(() => void refresh(), 30_000);
    return () => clearInterval(t);
  }, [refresh]);

  async function switchMode(mode: TradingMode) {
    if (!status || mode === status.mode || busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/agent-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      if (res.ok) setStatus({ ...status, mode });
    } finally {
      setBusy(false);
    }
  }

  const pulse = pulseState(status);
  const pnl = status?.todayPnlUsd ?? 0;

  return (
    <SurfaceCard
      padding="sm"
      className={cn("flex flex-wrap items-center gap-x-4 gap-y-2", className)}
    >
      <div className="flex min-w-0 items-center gap-2">
        <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-secondary">
          <Bot className="h-5 w-5 text-foreground" />
          <span
            className={cn(
              "absolute -bottom-0.5 -left-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-background",
              pulse.color,
            )}
          />
        </span>
        <span className="min-w-0">
          <span className="flex items-center gap-1 text-sm font-semibold">
            Claude MCP
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            {pulse.label}
          </span>
        </span>
      </div>

      <div className="flex items-center gap-1 rounded-full bg-secondary p-1 text-xs">
        {(Object.keys(MODE_LABEL) as TradingMode[]).map((m) => (
          <button
            key={m}
            type="button"
            disabled={busy || (m === "auto" && status ? !status.canAuto : false)}
            onClick={() => void switchMode(m)}
            className={cn(
              "rounded-full px-3 py-1 transition disabled:opacity-40",
              status?.mode === m
                ? "bg-background font-semibold text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {MODE_LABEL[m]}
          </button>
        ))}
      </div>

      <div className="ms-auto flex items-center gap-4 text-xs">
        <span className="text-muted-foreground">
          صفقات مفتوحة:{" "}
          <b className="text-foreground">{status?.openTrades ?? "—"}</b>
        </span>
        <span className="text-muted-foreground" dir="ltr">
          <b
            className={cn(
              pnl > 0
                ? "text-chart-1"
                : pnl < 0
                  ? "text-destructive"
                  : "text-foreground",
            )}
          >
            {pnl >= 0 ? "+" : ""}
            {pnl.toFixed(2)}$
          </b>{" "}
          اليوم
        </span>
      </div>
    </SurfaceCard>
  );
}
