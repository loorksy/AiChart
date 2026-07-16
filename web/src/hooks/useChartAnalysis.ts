"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChartOverlay } from "@/lib/chartOverlays";
import type { ChartDrawing } from "@/lib/chartDrawings";
import { computeRewardRisk } from "@/lib/rewardRisk";
import type { Recommendation } from "@/lib/types";
import type { ProcessedIntent } from "@/lib/tradeFlow";
import type { LiveReasoningEntry } from "@/lib/analysis/types";
import type { MarketType } from "@/lib/markets/types";

export interface ChartHydrateSnapshot {
  drawings?: ChartDrawing[];
  overlays?: ChartOverlay[];
  recommendation?: Recommendation | null;
  targets?: number[];
  liveReasoningLog?: LiveReasoningEntry[];
}

/**
 * Owns persisted chart presentation state only. Market decisions are produced
 * exclusively by the canonical chat agent and applied through its onResult.
 */
export function useChartAnalysis({
  symbol,
  interval,
  market,
  dataSource,
  hydrateSnapshot,
}: {
  symbol: string;
  interval: string;
  market: MarketType;
  dataSource?: "oanda" | "ea";
  hydrateSnapshot?: ChartHydrateSnapshot | null;
}) {
  const [overlays, setOverlays] = useState<ChartOverlay[]>([]);
  const [drawings, setDrawings] = useState<ChartDrawing[]>([]);
  const [recommendation, setRecommendation] = useState<Recommendation | null>(null);
  const [targets, setTargets] = useState<number[]>([]);
  const [liveReasoningLog, setLiveReasoningLog] = useState<LiveReasoningEntry[]>([]);
  const [, setHighlightDrawingIndex] = useState<number | null>(null);
  const contextRef = useRef(`${symbol}|${interval}|${market}|${dataSource ?? "default"}`);

  const riskReward = useMemo(() => {
    if (!recommendation?.entry || !recommendation.stop_loss || !recommendation.take_profit) return null;
    return computeRewardRisk(recommendation.entry, recommendation.stop_loss, recommendation.take_profit);
  }, [recommendation]);

  const clearLayers = useCallback(() => {
    setOverlays([]);
    setDrawings([]);
    setRecommendation(null);
    setTargets([]);
    setLiveReasoningLog([]);
    setHighlightDrawingIndex(null);
  }, []);

  const hydrateFromSnapshot = useCallback((snapshot: ChartHydrateSnapshot) => {
    setDrawings(snapshot.drawings ?? []);
    setOverlays(snapshot.overlays ?? []);
    setTargets((snapshot.targets ?? []).filter((target) => target > 0));
    setLiveReasoningLog(snapshot.liveReasoningLog ?? []);
    if (snapshot.recommendation !== undefined) setRecommendation(snapshot.recommendation);
  }, []);

  useEffect(() => {
    if (hydrateSnapshot) hydrateFromSnapshot(hydrateSnapshot);
  }, [hydrateSnapshot, hydrateFromSnapshot]);

  useEffect(() => {
    const next = `${symbol}|${interval}|${market}|${dataSource ?? "default"}`;
    if (next === contextRef.current) return;
    contextRef.current = next;
    clearLayers();
  }, [symbol, interval, market, dataSource, clearLayers]);

  return {
    isAnalyzing: false,
    analysisText: "",
    analyzeError: null as string | null,
    overlays,
    drawings,
    recommendation,
    targets,
    intents: [] as ProcessedIntent[],
    liveAnalysis: false,
    riskReward,
    liveReasoningLog,
    setHighlightDrawingIndex,
    clearLayers,
    stopLiveAnalysis: () => {},
    hydrateFromSnapshot,
    setDrawings,
    setRecommendation,
  };
}
