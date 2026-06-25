"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import type { PriceChartHandle } from "@/components/PriceChart";
import type { ChartOverlay } from "@/lib/chartOverlays";
import type { ChartDrawing } from "@/lib/chartDrawings";
import type { AgentActivity } from "@/lib/agentActivity";
import {
  chartVisionLabelAr,
  type ChartVisionSource,
} from "@/lib/marketAnalyzeLabels";
import { consumeSse } from "@/lib/sse";
import { computeRewardRisk } from "@/lib/riskGuard";
import type { Recommendation } from "@/lib/types";
import type { ProcessedIntent } from "@/lib/tradeFlow";
import type { MarketType } from "@/lib/markets/types";

export type ChartAnalyzeSource = "market" | "chat_chart";

export interface ChartAnalyzeDonePayload {
  reply: string;
  overlays?: ChartOverlay[];
  drawings?: ChartDrawing[];
  recommendation?: Recommendation | null;
  intents?: ProcessedIntent[];
  profileLabel?: string;
  contextSummary?: string[];
  telegramSent?: boolean;
  telegramReasonAr?: string;
  chartVisionSource?: ChartVisionSource;
  activities?: AgentActivity[];
}

export interface UseChartAnalysisOptions {
  symbol: string;
  interval: string;
  market: MarketType;
  chartRef: RefObject<PriceChartHandle | null>;
  /** When set, analysis is persisted and synced to chat. */
  conversationId?: number | null;
  source?: ChartAnalyzeSource;
  onCreditsUsed?: () => void;
  /** Called when streaming text deltas arrive (for chat injection). */
  onStreamDelta?: (text: string) => void;
  /** Called once when analysis completes successfully. */
  onAnalyzeDone?: (payload: ChartAnalyzeDonePayload) => void;
  /** Called when analysis starts (before fetch). */
  onAnalyzeStart?: () => void;
}

const LIVE_DEBOUNCE_MS = 1500;

export function useChartAnalysis({
  symbol,
  interval,
  market,
  chartRef,
  conversationId,
  source = "market",
  onCreditsUsed,
  onStreamDelta,
  onAnalyzeDone,
  onAnalyzeStart,
}: UseChartAnalysisOptions) {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisText, setAnalysisText] = useState("");
  const [overlays, setOverlays] = useState<ChartOverlay[]>([]);
  const [drawings, setDrawings] = useState<ChartDrawing[]>([]);
  const [recommendation, setRecommendation] = useState<Recommendation | null>(
    null,
  );
  const [intents, setIntents] = useState<ProcessedIntent[]>([]);
  const [profileLabel, setProfileLabel] = useState<string | null>(null);
  const [contextSummary, setContextSummary] = useState<string[]>([]);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [analyzeActivities, setAnalyzeActivities] = useState<AgentActivity[]>(
    [],
  );
  const [chartVisionLabel, setChartVisionLabel] = useState<string | null>(null);
  const [liveAnalysis, setLiveAnalysis] = useState(false);
  const [highlightDrawingIndex, setHighlightDrawingIndex] = useState<
    number | null
  >(null);

  const abortRef = useRef<AbortController | null>(null);
  const analyzingRef = useRef(false);
  const liveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contextKeyRef = useRef(`${symbol}|${interval}|${market}`);
  const skipLiveOnceRef = useRef(false);

  const riskReward = useMemo(() => {
    if (!recommendation?.entry || !recommendation.stop_loss || !recommendation.take_profit) {
      return null;
    }
    return computeRewardRisk(
      recommendation.entry,
      recommendation.stop_loss,
      recommendation.take_profit,
    );
  }, [recommendation]);

  const clearLayers = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    if (liveTimerRef.current) {
      clearTimeout(liveTimerRef.current);
      liveTimerRef.current = null;
    }
    setLiveAnalysis(false);
    setOverlays([]);
    setDrawings([]);
    setRecommendation(null);
    setIntents([]);
    setProfileLabel(null);
    setContextSummary([]);
    setHighlightDrawingIndex(null);
    setAnalysisText("");
    setAnalyzeActivities([]);
    setChartVisionLabel(null);
  }, []);

  const applyDonePayload = useCallback((data: ChartAnalyzeDonePayload, streamed: string) => {
    setAnalysisText(data.reply || streamed);
    setOverlays(data.overlays?.length ? data.overlays : []);
    setDrawings(data.drawings?.length ? data.drawings : []);
    setRecommendation(data.recommendation ?? null);
    setIntents(data.intents ?? []);
    if (data.profileLabel) setProfileLabel(data.profileLabel);
    if (data.contextSummary?.length) setContextSummary(data.contextSummary);
    if (data.activities?.length) setAnalyzeActivities(data.activities);
    if (data.chartVisionSource) {
      setChartVisionLabel(chartVisionLabelAr(data.chartVisionSource));
    }

    if (data.telegramSent) {
      setToast("أُرسلت التوصية إلى تليجرام — اختر المبلغ بعد الموافقة");
    } else if (
      data.telegramReasonAr &&
      data.telegramReasonAr !== "لا إشارة تنفيذية"
    ) {
      setToast(`لم يُرسل إلى تليجرام — ${data.telegramReasonAr}`);
    } else if (data.chartVisionSource === "text") {
      setToast("تعذّر التقاط الشارت — تم التحليل النصي");
    } else if (
      data.chartVisionSource === "client" ||
      data.chartVisionSource === "server"
    ) {
      setToast("تم التحليل من الشارت");
    }
  }, []);

  const analyze = useCallback(
    async (opts?: { enableLive?: boolean }) => {
      if (analyzingRef.current) return;

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      analyzingRef.current = true;
      setIsAnalyzing(true);
      setAnalyzeError(null);
      setAnalysisText("");
      setAnalyzeActivities([]);
      setChartVisionLabel(null);
      onAnalyzeStart?.();

      try {
        const chartImage = await chartRef.current?.capturePng().catch(() => null);

        const body: Record<string, unknown> = {
          symbol,
          interval,
          market,
          stream: true,
          source,
          ...(chartImage ? { image: chartImage } : {}),
        };
        if (conversationId) {
          body.conversationId = conversationId;
          body.persistToChat = true;
        }

        const res = await fetch("/api/market/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setAnalyzeError(
            (data as { error?: string }).error ?? "تعذّر بدء التحليل.",
          );
          return;
        }

        let streamError: string | null = null;
        let streamed = "";

        const data = await consumeSse<ChartAnalyzeDonePayload>(res, {
          onActivity: (a) => {
            setAnalyzeActivities((prev) => {
              const idx = prev.findIndex((x) => x.id === a.id);
              if (idx >= 0) {
                const next = [...prev];
                next[idx] = a;
                return next;
              }
              return [...prev, a];
            });
          },
          onDelta: (t) => {
            streamed += t;
            setAnalysisText(streamed);
            onStreamDelta?.(t);
          },
          onError: (msg) => {
            streamError = msg;
            setAnalyzeError(msg);
          },
        });

        if (controller.signal.aborted) return;

        if (!data) {
          if (!streamError) setAnalyzeError("لم يصل تحليل من الوكيل.");
          return;
        }

        applyDonePayload(data, streamed);
        onAnalyzeDone?.(data);
        onCreditsUsed?.();

        if (opts?.enableLive !== false) {
          setLiveAnalysis(true);
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setAnalyzeError("حدث خطأ أثناء التحليل.");
      } finally {
        analyzingRef.current = false;
        if (abortRef.current === controller) {
          abortRef.current = null;
        }
        setIsAnalyzing(false);
      }
    },
    [
      symbol,
      interval,
      market,
      chartRef,
      conversationId,
      source,
      onAnalyzeStart,
      onStreamDelta,
      onAnalyzeDone,
      onCreditsUsed,
      applyDonePayload,
    ],
  );

  const stopLiveAnalysis = useCallback(() => {
    setLiveAnalysis(false);
    if (liveTimerRef.current) {
      clearTimeout(liveTimerRef.current);
      liveTimerRef.current = null;
    }
  }, []);

  // Context change: clear or re-analyze in live mode
  useEffect(() => {
    const key = `${symbol}|${interval}|${market}`;
    if (key === contextKeyRef.current) return;
    contextKeyRef.current = key;

    if (skipLiveOnceRef.current) {
      skipLiveOnceRef.current = false;
      return;
    }

    abortRef.current?.abort();
    setOverlays([]);
    setDrawings([]);
    setRecommendation(null);
    setIntents([]);
    setProfileLabel(null);
    setContextSummary([]);
    setHighlightDrawingIndex(null);
    setAnalysisText("");
    setAnalyzeError(null);

    if (!liveAnalysis) return;

    if (liveTimerRef.current) clearTimeout(liveTimerRef.current);
    liveTimerRef.current = setTimeout(() => {
      void analyze({ enableLive: true });
    }, LIVE_DEBOUNCE_MS);

    return () => {
      if (liveTimerRef.current) {
        clearTimeout(liveTimerRef.current);
        liveTimerRef.current = null;
      }
    };
  }, [symbol, interval, market, liveAnalysis, analyze]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(t);
  }, [toast]);

  return {
    isAnalyzing,
    analysisText,
    overlays,
    drawings,
    recommendation,
    intents,
    profileLabel,
    contextSummary,
    analyzeError,
    toast,
    analyzeActivities,
    chartVisionLabel,
    liveAnalysis,
    riskReward,
    highlightDrawingIndex,
    setHighlightDrawingIndex,
    analyze,
    clearLayers,
    stopLiveAnalysis,
    setOverlays,
    setDrawings,
    setRecommendation,
  };
}
