"use client";

import { useEffect, useRef } from "react";
import type { Dispatch, SetStateAction } from "react";
import { fetchWithTimeout } from "@/lib/fetchWithTimeout";
import {
  lifecycleMatchesChartRecommendation,
  mergeLifecycleIntoRecommendation,
  type ChartLifecycle,
} from "@/lib/recommendations/chartLifecycle";
import type { Recommendation } from "@/lib/types";

const POLL_MS = 10_000;

/**
 * Mirrors the tracker's verdict for the active chat's plan onto the chart
 * payload so the P/L box can move through pending → filled → closed. The
 * tracker (server sweep) grades; this hook only copies status / fill time /
 * exit time onto the recommendation the chart is painting, and stops polling
 * once the plan is terminal.
 */
export function useRecommendationLifecycle(input: {
  enabled: boolean;
  chatId: string | null | undefined;
  recommendation: Recommendation | null;
  setRecommendation: Dispatch<SetStateAction<Recommendation | null>>;
}): void {
  const { enabled, chatId, recommendation, setRecommendation } = input;
  const recRef = useRef(recommendation);
  useEffect(() => {
    recRef.current = recommendation;
  }, [recommendation]);

  const live =
    enabled &&
    Boolean(chatId) &&
    recommendation != null &&
    (recommendation.action === "buy" || recommendation.action === "sell") &&
    !(typeof recommendation.outcome === "string" && recommendation.outcome !== "" && recommendation.outcome !== "pending");

  useEffect(() => {
    if (!live || !chatId) return;
    let stopped = false;

    const tick = async () => {
      if (stopped) return;
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetchWithTimeout(
          `/api/recommendations/session-status?chatId=${encodeURIComponent(chatId)}`,
          { cache: "no-store", timeoutMs: 6_000 },
        );
        if (!res.ok) return;
        const data = (await res.json()) as { recommendation?: ChartLifecycle | null };
        const life = data.recommendation;
        if (stopped || !life) return;
        const current = recRef.current;
        if (!current || !lifecycleMatchesChartRecommendation(life, current)) return;
        setRecommendation((prev) => {
          if (!prev || !lifecycleMatchesChartRecommendation(life, prev)) return prev;
          return mergeLifecycleIntoRecommendation(prev, life);
        });
      } catch {
        /* transient — next tick */
      }
    };

    void tick();
    const t = window.setInterval(() => void tick(), POLL_MS);
    return () => {
      stopped = true;
      window.clearInterval(t);
    };
  }, [live, chatId, setRecommendation]);
}
