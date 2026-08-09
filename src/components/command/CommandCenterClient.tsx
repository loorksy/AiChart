"use client";

import { useCallback, useEffect, useState } from "react";
import { PageLayout, SurfaceCard } from "@/components/ui/shell";
import type { MarketContext } from "@/lib/marketContext";
import type { TradeLesson } from "@/lib/types";
import { HeatmapGrid, type HeatmapCell } from "./HeatmapGrid";
import { WhaleBubbles } from "./WhaleBubbles";
import { MacroTicker } from "./MacroTicker";
import { MemoryHighlights } from "./MemoryHighlights";

export default function CommandCenterClient() {
  const [cells, setCells] = useState<HeatmapCell[]>([]);
  const [flow, setFlow] = useState<{ signals: unknown; updatedAt?: string } | null>(
    null,
  );
  const [macro, setMacro] = useState<MarketContext | null>(null);
  const [lessons, setLessons] = useState<TradeLesson[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const [heatmapRes, flowRes, macroRes] = await Promise.all([
        fetch("/api/command/heatmap"),
        fetch("/api/command/flow"),
        fetch("/api/command/macro"),
      ]);
      if (heatmapRes.ok) {
        const data = (await heatmapRes.json()) as { cells: HeatmapCell[] };
        setCells(data.cells ?? []);
      }
      if (flowRes.ok) {
        const data = (await flowRes.json()) as {
          signals: unknown;
          updatedAt?: string;
        };
        setFlow(data);
      }
      if (macroRes?.ok) {
        const data = (await macroRes.json()) as { context?: MarketContext };
        if (data.context) setMacro(data.context);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), 30_000);
    return () => clearInterval(id);
  }, [refresh]);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/command/memory");
        if (res.ok) {
          const data = (await res.json()) as { lessons?: TradeLesson[] };
          setLessons(data.lessons ?? []);
        }
      } catch {
        /* ignore */
      }
    })();
  }, []);

  return (
    <PageLayout title="مركز القيادة" subtitle="heatmap · تدفّق · ذاكرة">
      <div className="grid gap-4 lg:grid-cols-3">
        <SurfaceCard className="lg:col-span-2">
          <h2 className="mb-3 text-sm font-medium">Heatmap الأداء</h2>
          {loading ? (
            <p className="text-sm text-muted-foreground">جارٍ التحميل…</p>
          ) : (
            <HeatmapGrid cells={cells} />
          )}
        </SurfaceCard>

        <SurfaceCard>
          <h2 className="mb-3 text-sm font-medium">ماكرو</h2>
          <MacroTicker context={macro} />
        </SurfaceCard>

        <SurfaceCard className="lg:col-span-2">
          <h2 className="mb-2 text-sm font-medium">Whale Bubbles</h2>
          <p className="mb-2 text-[10px] text-muted-foreground">
            آخر تحديث: {flow?.updatedAt ?? "—"}
          </p>
          <WhaleBubbles signalsRaw={flow?.signals} />
        </SurfaceCard>

        <SurfaceCard className="lg:col-span-3">
          <h2 className="mb-3 text-sm font-medium">دروس الذاكرة</h2>
          <MemoryHighlights lessons={lessons} />
        </SurfaceCard>
      </div>
    </PageLayout>
  );
}
