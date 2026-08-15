"use client";

import { useState } from "react";
import Link from "next/link";
import { Clock } from "lucide-react";
import { SurfaceCard } from "@/components/ui/shell";
import type { TradingSettings, TradeIntent } from "@/lib/types";
import { OpportunityScanCard } from "./OpportunityScanCard";
import { PendingIntentQuickActions } from "./PendingIntentQuickActions";

export function WaitingRoom({
  settings: _settings,
  pendingIntents,
  watchlistCount,
}: {
  settings: TradingSettings;
  pendingIntents: TradeIntent[];
  watchlistCount: number;
}) {
  const [pending, setPending] = useState(pendingIntents);
  return (
    <div className="space-y-4">
      <SurfaceCard className="space-y-2">
        <div className="flex items-center gap-2"><Clock className="h-5 w-5 text-primary" /><h2 className="font-semibold">السوق تحت المراقبة</h2></div>
        <p className="text-sm text-muted-foreground">Scalping · إطار 5m · {watchlistCount || "أفضل"} أزواج في قائمة المتابعة.</p>
        <Link href="/chat" className="inline-flex min-h-11 items-center text-sm font-medium text-primary hover:underline">افتح الشارت والمحادثة</Link>
      </SurfaceCard>
      <OpportunityScanCard analysisInterval="5m" activeMarket="forex" />
      {pending.length > 0 && <PendingIntentQuickActions intents={pending} onChange={setPending} />}
    </div>
  );
}
