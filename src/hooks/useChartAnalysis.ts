"use client";

import type { MarketDataSource } from "@/lib/markets/marketDataSource";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChartOverlay } from "@/lib/chartOverlays";
import type { ChartDrawing } from "@/lib/chartDrawings";
import type { ChartStudy } from "@/lib/chart/studies";
import { computeRewardRisk } from "@/lib/rewardRisk";
import { withStableCreatedAt } from "@/lib/recommendations/anchorTime";
import { planTargetList } from "@/lib/chart/planTargets";
import type { Recommendation } from "@/lib/types";
import type { LiveReasoningEntry } from "@/lib/analysis/types";
import type { MarketType } from "@/lib/markets/types";

export interface ChartHydrateSnapshot {
  drawings?: ChartDrawing[];
  overlays?: ChartOverlay[];
  studies?: ChartStudy[];
  recommendation?: Recommendation | null;
  targets?: number[];
  liveReasoningLog?: LiveReasoningEntry[];
}

/** Return the previous reference when the next value is structurally identical. */
function keepIfEqual<T>(prev: T, next: T): T {
  if (prev === next) return prev;
  try {
    return JSON.stringify(prev) === JSON.stringify(next) ? prev : next;
  } catch {
    return next;
  }
}

/**
 * Owns persisted chart presentation state only. Market decisions are produced
 * exclusively by the canonical chat agent and applied through its onResult.
 */
export function useChartAnalysis({
  symbol,
  market,
  dataSource,
  hydrateSnapshot,
}: {
  symbol: string;
  /** Accepted for call-site compatibility; interval changes never clear layers. */
  interval?: string;
  market: MarketType;
  dataSource?: MarketDataSource;
  hydrateSnapshot?: ChartHydrateSnapshot | null;
}) {
  const [overlays, setOverlays] = useState<ChartOverlay[]>([]);
  const [drawings, setDrawings] = useState<ChartDrawing[]>([]);
  const [studies, setStudies] = useState<ChartStudy[]>([]);
  const [recommendation, setRecommendation] = useState<Recommendation | null>(null);
  const [targets, setTargets] = useState<number[]>([]);
  const [liveReasoningLog, setLiveReasoningLog] = useState<LiveReasoningEntry[]>([]);
  const [, setHighlightDrawingIndex] = useState<number | null>(null);
  // Interval is deliberately NOT part of the reset key: drawings are anchored by
  // absolute time+price, so a recommendation drawn on 15m must survive a switch
  // to 1h and re-render when the operator returns. Only a different instrument
  // (or market/data source) makes the layers meaningless.
  const contextRef = useRef(`${symbol}|${market}|${dataSource ?? "default"}`);

  const riskReward = useMemo(() => {
    if (!recommendation?.entry || !recommendation.stop_loss || !recommendation.take_profit) return null;
    return computeRewardRisk(recommendation.entry, recommendation.stop_loss, recommendation.take_profit);
  }, [recommendation]);

  const clearLayers = useCallback(() => {
    setOverlays([]);
    setDrawings([]);
    setStudies([]);
    setRecommendation(null);
    setTargets([]);
    setLiveReasoningLog([]);
    setHighlightDrawingIndex(null);
  }, []);

  const hydrateFromSnapshot = useCallback((snapshot: ChartHydrateSnapshot) => {
    // Keep previous references when the payload is unchanged. The layout poll
    // re-delivers identical state every few seconds; handing the chart a fresh
    // array each time forces a full clear+redraw of every shape — which is what
    // made agent drawings visibly flicker and position tools jump.
    setDrawings((prev) => keepIfEqual(prev, snapshot.drawings ?? []));
    setOverlays((prev) => keepIfEqual(prev, snapshot.overlays ?? []));
    setStudies((prev) => keepIfEqual(prev, snapshot.studies ?? []));
    setTargets((prev) =>
      keepIfEqual(
        prev,
        planTargetList({
          targets:
            snapshot.targets && snapshot.targets.length > 0
              ? snapshot.targets
              : snapshot.recommendation?.targets,
          takeProfit: snapshot.recommendation?.take_profit,
          targetsJson: snapshot.recommendation?.targets_json,
        }),
      ),
    );
    setLiveReasoningLog((prev) => keepIfEqual(prev, snapshot.liveReasoningLog ?? []));
    if (snapshot.recommendation !== undefined) {
      // withStableCreatedAt: the chart anchors the profit/loss zones at the
      // recommendation's created_at. A hydrated payload keeps its persisted
      // anchor byte-for-byte; a legacy payload without one inherits the anchor
      // of the same in-memory plan (so the 4s poll never re-anchors it) or is
      // stamped once — the stamp then persists through the layout autosave.
      setRecommendation((prev) =>
        keepIfEqual(prev, withStableCreatedAt(snapshot.recommendation ?? null, prev)),
      );
    }
  }, []);

  useEffect(() => {
    if (hydrateSnapshot) hydrateFromSnapshot(hydrateSnapshot);
  }, [hydrateSnapshot, hydrateFromSnapshot]);

  useEffect(() => {
    const next = `${symbol}|${market}|${dataSource ?? "default"}`;
    if (next === contextRef.current) return;
    contextRef.current = next;
    clearLayers();
  }, [symbol, market, dataSource, clearLayers]);

  return {
    isAnalyzing: false,
    analysisText: "",
    analyzeError: null as string | null,
    overlays,
    drawings,
    studies,
    recommendation,
    targets,
    liveAnalysis: false,
    riskReward,
    liveReasoningLog,
    setHighlightDrawingIndex,
    clearLayers,
    stopLiveAnalysis: () => {},
    hydrateFromSnapshot,
    setDrawings,
    setStudies,
    setRecommendation,
    setTargets,
  };
}
