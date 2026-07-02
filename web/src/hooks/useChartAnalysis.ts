"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import type { ChatImagePayload } from "@/lib/chatImage";
import type { ChartOverlay } from "@/lib/chartOverlays";

/** Minimal, engine-agnostic chart handle the analysis flow needs. */
export type ChartCaptureHandle = {
  capturePng: () => Promise<ChatImagePayload | null>;
  currentSymbol: () => string;
};
import type { ChartDrawing } from "@/lib/chartDrawings";
import type { AgentActivity } from "@/lib/agentActivity";
import {
  chartVisionLabelAr,
  type ChartVisionSource,
} from "@/lib/marketAnalyzeLabels";
import { compressChartImage } from "@/lib/chartImageCompress";
import { consumeSse } from "@/lib/sse";
import { computeRewardRisk } from "@/lib/rewardRisk";
import type { Recommendation } from "@/lib/types";
import type { ProcessedIntent } from "@/lib/tradeFlow";
import type { LiveReasoningEntry } from "@/lib/analysis/chartAnalyzeLlm";
import type { TradingStyle } from "@/lib/types";
import type { MarketType } from "@/lib/markets/types";

export type ChartAnalyzeSource = "market" | "smart_chart";

export interface ChartAnalyzeDonePayload {
  reply: string;
  overlays?: ChartOverlay[];
  drawings?: ChartDrawing[];
  recommendation?: Recommendation | null;
  /** All take-profit targets (rec.take_profit is the first). */
  targets?: number[];
  intents?: ProcessedIntent[];
  profileLabel?: string;
  contextSummary?: string[];
  telegramSent?: boolean;
  telegramReasonAr?: string;
  chartVisionSource?: ChartVisionSource;
  activities?: AgentActivity[];
  liveReasoningLog?: LiveReasoningEntry[];
}

export interface ChartHydrateSnapshot {
  drawings?: ChartDrawing[];
  overlays?: ChartOverlay[];
  recommendation?: Recommendation | null;
  targets?: number[];
  liveReasoningLog?: LiveReasoningEntry[];
}

export interface UseChartAnalysisOptions {
  symbol: string;
  interval: string;
  market: MarketType;
  chartRef: RefObject<ChartCaptureHandle | null>;
  source?: ChartAnalyzeSource;
  /** Trading style drives analyze prompts (scalp/day/swing/position). */
  tradingStyle?: TradingStyle;
  /** Restore persisted analysis layers without re-running API. */
  hydrateSnapshot?: ChartHydrateSnapshot | null;
  /** Chart layout id — the server persists the finished analysis into it,
   *  so closing the tab mid-analysis still yields the result on next open. */
  layoutId?: string;
  onCreditsUsed?: () => void;
  /** Called when streaming text deltas arrive (for chat injection). */
  onStreamDelta?: (text: string) => void;
  /** Called once when analysis completes successfully. */
  onAnalyzeDone?: (payload: ChartAnalyzeDonePayload) => void;
  /** Called when analysis starts (before fetch). */
  onAnalyzeStart?: () => void;
  /** Real agent tool/activity events during analysis (for chat timeline). */
  onActivity?: (activity: AgentActivity) => void;
  /** Called when analysis fails (stream or HTTP error). */
  onAnalyzeError?: (message: string) => void;
}

const LIVE_DEBOUNCE_MS = 1500;

/** Loose ticker equality across broker suffixes (EURUSD ≈ EURUSD.r ≈ EURUSDm). */
function symbolsMatch(a?: string, b?: string): boolean {
  if (!a || !b) return false;
  const na = a.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const nb = b.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!na || !nb) return false;
  return na === nb || na.startsWith(nb) || nb.startsWith(na);
}

export function useChartAnalysis({
  symbol,
  interval,
  market,
  chartRef,
  source = "market",
  tradingStyle,
  onCreditsUsed,
  onStreamDelta,
  onAnalyzeDone,
  onAnalyzeStart,
  onActivity,
  onAnalyzeError,
  hydrateSnapshot,
  layoutId,
}: UseChartAnalysisOptions) {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisText, setAnalysisText] = useState("");
  const [overlays, setOverlays] = useState<ChartOverlay[]>([]);
  const [drawings, setDrawings] = useState<ChartDrawing[]>([]);
  const [recommendation, setRecommendation] = useState<Recommendation | null>(
    null,
  );
  const [targets, setTargets] = useState<number[]>([]);
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
  const [liveReasoningLog, setLiveReasoningLog] = useState<LiveReasoningEntry[]>([]);
  const drawingContextRef = useRef(`${symbol}|${market}`);
  const analysisContextRef = useRef(`${symbol}|${interval}|${market}`);
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
    setTargets([]);
    setIntents([]);
    setProfileLabel(null);
    setContextSummary([]);
    setHighlightDrawingIndex(null);
    setAnalysisText("");
    setAnalyzeActivities([]);
    setLiveReasoningLog([]);
    setChartVisionLabel(null);
  }, []);

  const applyDonePayload = useCallback((data: ChartAnalyzeDonePayload, streamed: string) => {
    setAnalysisText(data.reply || streamed);
    setOverlays(data.overlays?.length ? data.overlays : []);
    setDrawings(data.drawings?.length ? data.drawings : []);
    setRecommendation(data.recommendation ?? null);
    setTargets(
      data.targets?.length
        ? data.targets.filter((t) => t > 0)
        : data.recommendation?.take_profit != null && data.recommendation.take_profit > 0
          ? [data.recommendation.take_profit]
          : [],
    );
    setIntents(data.intents ?? []);
    if (data.profileLabel) setProfileLabel(data.profileLabel);
    if (data.contextSummary?.length) setContextSummary(data.contextSummary);
    if (data.activities?.length) setAnalyzeActivities(data.activities);
    if (data.liveReasoningLog?.length) setLiveReasoningLog(data.liveReasoningLog);
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

  const hydrateFromSnapshot = useCallback((snap: ChartHydrateSnapshot) => {
    if (snap.drawings?.length) setDrawings(snap.drawings);
    if (snap.overlays?.length) setOverlays(snap.overlays);
    if (snap.targets?.length) setTargets(snap.targets.filter((t) => t > 0));
    if (snap.liveReasoningLog?.length) setLiveReasoningLog(snap.liveReasoningLog);
    if (snap.recommendation !== undefined) {
      setRecommendation(snap.recommendation);
    }
  }, []);

  useEffect(() => {
    if (!hydrateSnapshot) return;
    hydrateFromSnapshot(hydrateSnapshot);
  }, [hydrateSnapshot, hydrateFromSnapshot]);

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
      setLiveReasoningLog([]);
      onAnalyzeStart?.();

      try {
        // Analyze the pair the chart ACTUALLY shows (Pro widget is authoritative;
        // React state can lag a fast symbol switch), so the result never belongs
        // to a different pair than the one on screen.
        const reqSymbol = (
          chartRef.current?.currentSymbol?.() ?? symbol
        )
          .toUpperCase()
          .trim();

        const rawImage = await chartRef.current?.capturePng().catch(() => null);
        const chartImage = rawImage
          ? await compressChartImage(rawImage).catch(() => rawImage)
          : null;

        const body: Record<string, unknown> = {
          symbol: reqSymbol,
          interval,
          market,
          stream: true,
          source,
          ...(layoutId ? { layout_id: layoutId } : {}),
          ...(chartImage ? { image: chartImage } : {}),
        };

        const res = await fetch("/api/market/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          const msg =
            res.status === 413
              ? "حجم طلب التحليل كبير — أُعيد ضغط الصورة؛ إن استمر الخطأ حدّث الصفحة وأعد المحاولة."
              : (data as { error?: string }).error ?? "تعذّر بدء التحليل.";
          setAnalyzeError(msg);
          onAnalyzeError?.(msg);
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
            onActivity?.(a);
          },
          onDelta: (t) => {
            streamed += t;
            setAnalysisText(streamed);
            onStreamDelta?.(t);
          },
          onError: (msg) => {
            streamError = msg;
            setAnalyzeError(msg);
            onAnalyzeError?.(msg);
          },
        });

        if (controller.signal.aborted) return;

        if (!data) {
          if (!streamError) {
            const msg = "لم يصل تحليل من الوكيل.";
            setAnalyzeError(msg);
            onAnalyzeError?.(msg);
          }
          return;
        }

        // If the chart moved to another pair while analysis ran, drop the result
        // rather than paint one pair's analysis onto another.
        const nowSymbol = (
          chartRef.current?.currentSymbol?.() ?? symbol
        ).toUpperCase();
        if (!symbolsMatch(nowSymbol, reqSymbol)) return;

        applyDonePayload(data, streamed);
        onAnalyzeDone?.(data);
        onCreditsUsed?.();

        if (opts?.enableLive !== false) {
          setLiveAnalysis(true);
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        const msg =
          err instanceof Error && err.message.trim()
            ? err.message
            : "حدث خطأ أثناء التحليل.";
        setAnalyzeError(msg);
        onAnalyzeError?.(msg);
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
      source,
      tradingStyle,
      layoutId,
      onAnalyzeStart,
      onStreamDelta,
      onAnalyzeDone,
      onAnalyzeError,
      onActivity,
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

  // Symbol/market change clears drawings; interval change keeps them (time+price reproject).
  useEffect(() => {
    const drawingKey = `${symbol}|${market}`;
    const analysisKey = `${symbol}|${interval}|${market}`;

    const symbolChanged = drawingKey !== drawingContextRef.current;
    const intervalChanged = analysisKey !== analysisContextRef.current;

    if (!symbolChanged && !intervalChanged) return;

    drawingContextRef.current = drawingKey;
    analysisContextRef.current = analysisKey;

    if (skipLiveOnceRef.current) {
      skipLiveOnceRef.current = false;
      return;
    }

    abortRef.current?.abort();

    if (symbolChanged) {
      setOverlays([]);
      setDrawings([]);
      setLiveReasoningLog([]);
      setRecommendation(null);
      setTargets([]);
      setIntents([]);
      setProfileLabel(null);
      setContextSummary([]);
      setHighlightDrawingIndex(null);
      setAnalysisText("");
      setAnalyzeError(null);
    } else if (intervalChanged) {
      setAnalysisText("");
      setAnalyzeError(null);
    }

    if (!liveAnalysis || !symbolChanged) return;

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
    targets,
    intents,
    profileLabel,
    contextSummary,
    analyzeError,
    toast,
    analyzeActivities,
    chartVisionLabel,
    liveAnalysis,
    riskReward,
    liveReasoningLog,
    highlightDrawingIndex,
    setHighlightDrawingIndex,
    analyze,
    clearLayers,
    stopLiveAnalysis,
    hydrateFromSnapshot,
    setOverlays,
    setDrawings,
    setRecommendation,
  };
}
