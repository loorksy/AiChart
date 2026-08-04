"use client";

import { useCallback, useEffect, useState } from "react";
import { Bot, CheckCircle2 } from "lucide-react";
import { SurfaceCard } from "@/components/ui/shell";
import { cn } from "@/lib/utils";

interface AgentStatus {
  bridgeConfigured: boolean;
  lastSeen: string | null;
  executionAuthorized: boolean;
  openTrades: number;
  todayPnlUsd: number;
}

export function AgentStatusBar({ className }: { className?: string }) {
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/agent-status", { cache: "no-store" });
      if (response.ok) setStatus((await response.json()) as AgentStatus);
    } catch {
      // Keep the last usable technical snapshot.
    }
  }, []);
  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const active = Boolean(status?.bridgeConfigured && status.lastSeen);
  return (
    <SurfaceCard padding="sm" className={cn("flex flex-wrap items-center gap-3", className)}>
      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-secondary"><Bot className="h-5 w-5" /></span>
      <div className="min-w-0">
        <p className="flex items-center gap-2 text-sm font-semibold">وكيل Lonora <span className={cn("h-2 w-2 rounded-full", active ? "bg-emerald-500" : "bg-muted-foreground")} /></p>
        <p className="text-xs text-muted-foreground">Scalping · القرار بواسطة الذكاء الاصطناعي</p>
      </div>
      <div className="ms-auto flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1"><CheckCircle2 className="h-4 w-4" />{status?.executionAuthorized ? "التنفيذ مخوّل" : "التنفيذ غير مخوّل"}</span>
        <span>مفتوحة: {status?.openTrades ?? "—"}</span>
      </div>
    </SurfaceCard>
  );
}
