"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Clock, Loader2 } from "lucide-react";
import { SurfaceCard } from "@/components/ui/shell";
import type { TradingSettings, TradeIntent } from "@/lib/types";
import { OpportunityScanCard } from "./OpportunityScanCard";
import { PendingIntentQuickActions } from "./PendingIntentQuickActions";
import type { OpportunityScanResult } from "@/lib/opportunityScan";
import { normalizeInterval } from "@/lib/intervals";

export function WaitingRoom({
  settings,
  pendingIntents: initialPending,
  watchlistCount,
}: {
  settings: TradingSettings;
  pendingIntents: TradeIntent[];
  watchlistCount: number;
}) {
  const [pending, setPending] = useState(initialPending);
  const [lastScan, setLastScan] = useState(settings.last_manual_scan_at);
  const [polling, setPolling] = useState(false);

  const pollMinutes = settings.scan_poll_minutes ?? 0;
  const analysisInterval = normalizeInterval(
    settings.analysis_interval ?? "1h",
  );
  const activeMarket = settings.active_market ?? "crypto";

  const runPollScan = useCallback(async () => {
    if (pollMinutes <= 0) return;
    setPolling(true);
    try {
      await fetch("/api/opportunities/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deep: false,
          skipCooldown: true,
          interval: analysisInterval,
          market: activeMarket,
        }),
      });
      setLastScan(new Date().toISOString());
    } catch {
      /* ignore */
    } finally {
      setPolling(false);
    }
  }, [pollMinutes, analysisInterval, activeMarket]);

  useEffect(() => {
    if (pollMinutes <= 0) return;
    const ms = pollMinutes * 60 * 1000;
    const id = window.setInterval(() => void runPollScan(), ms);
    return () => window.clearInterval(id);
  }, [pollMinutes, runPollScan]);

  function onScanComplete(result: OpportunityScanResult) {
    setLastScan(result.scannedAt);
    if (result.deepAnalysis?.intents?.length) {
      void fetch("/api/trades")
        .then((r) => r.json())
        .then((d) => {
          if (Array.isArray(d.intents)) {
            setPending(d.intents.filter((i: TradeIntent) => i.status === "pending"));
          }
        })
        .catch(() => {});
    }
  }

  const modeLabel =
    settings.mode === "auto"
      ? settings.approval === "delegate"
        ? "تنفيذ تلقائي — الوكيل يتداول وينتظر"
        : "تنفيذ تلقائي مع موافقتك"
      : "توصيات — بانتظار موافقتك";

  const marketLabel = activeMarket === "forex" ? "فوركس" : "كريبتو";

  return (
    <div className="space-y-4">
      <SurfaceCard className="space-y-2">
        <div className="flex items-center gap-2">
          <Clock className="h-5 w-5 text-chart-1" />
          <h2 className="font-semibold">لوحة الانتظار</h2>
          {polling && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        </div>
        <p className="text-sm text-muted-foreground">{modeLabel}</p>
        <p className="text-sm text-muted-foreground">
          يراقب {watchlistCount > 0 ? watchlistCount : "أفضل"} زوج · إطار{" "}
          {analysisInterval} · {marketLabel}
          {pollMinutes > 0
            ? ` · مسح تلقائي كل ${pollMinutes} دقيقة`
            : " · مسح تلقائي غير مفعّل"}
        </p>
        {lastScan && (
          <p className="text-xs text-muted-foreground" dir="ltr">
            آخر مسح: {new Date(lastScan).toLocaleString("ar")}
          </p>
        )}
        <Link href="/market" className="text-sm text-primary hover:underline">
          افتح الشارت →
        </Link>
      </SurfaceCard>

      <OpportunityScanCard
        onScanComplete={onScanComplete}
        analysisInterval={analysisInterval}
        activeMarket={activeMarket}
      />

      {pending.length > 0 && (
        <PendingIntentQuickActions
          intents={pending}
          onChange={(next) => setPending(next)}
        />
      )}
    </div>
  );
}
