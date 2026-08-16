"use client";

import { Radio, X } from "lucide-react";
import { LiveAnalysisLog } from "@/components/chart/LiveAnalysisLog";
import type { ChartDrawing } from "@/lib/chartDrawings";
import type { LiveReasoningEntry } from "@/lib/analysis/types";
import type { Recommendation } from "@/lib/types";
import { cn } from "@/lib/utils";

export function ChartTradeOverlay({
  recommendation,
  isAnalyzing,
  liveAnalysis,
  liveReasoningLog,
  drawings,
  onHighlightDrawing,
  onStopLive,
  className,
}: {
  recommendation?: Recommendation | null;
  targets?: number[];
  riskReward?: number | null;
  isAnalyzing?: boolean;
  liveAnalysis?: boolean;
  liveReasoningLog?: LiveReasoningEntry[];
  drawings?: ChartDrawing[];
  onHighlightDrawing?: (index: number | null) => void;
  onStopLive?: () => void;
  className?: string;
}) {
  const hasTrade =
    recommendation &&
    (recommendation.action === "buy" || recommendation.action === "sell");

  const waitOnly =
    !hasTrade &&
    (recommendation?.action === "wait" ||
      (!recommendation && (liveReasoningLog?.length ?? 0) > 0));

  if (
    !hasTrade &&
    !isAnalyzing &&
    !liveAnalysis &&
    !drawings?.length &&
    !(liveReasoningLog?.length)
  ) {
    return null;
  }

  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-x-2 bottom-2 z-20 flex flex-col items-end gap-1.5 sm:inset-x-auto sm:end-2",
        className,
      )}
    >
      {liveAnalysis && (
        <div
          className={cn(
            "pointer-events-auto inline-flex items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/10 px-2 py-1 text-[10px] font-medium text-primary backdrop-blur-md",
            isAnalyzing && "animate-pulse",
          )}
        >
          <Radio className="h-3 w-3" />
          <span>تحليل حي</span>
          {onStopLive && (
            <button
              type="button"
              onClick={onStopLive}
              className="ms-1 rounded p-0.5 hover:bg-primary/20"
              aria-label="إيقاف التحليل الحي"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      )}

      {!hasTrade && (liveReasoningLog?.length || isAnalyzing || waitOnly) && (
        <div className="pointer-events-auto w-full max-w-[300px] sm:w-72">
          <LiveAnalysisLog
            entries={liveReasoningLog}
            isAnalyzing={isAnalyzing}
            waitMessage={
              waitOnly && !hasTrade
                ? "لا توجد صفقة ناضجة حالياً."
                : undefined
            }
            onHighlightDrawing={onHighlightDrawing}
          />
        </div>
      )}

    </div>
  );
}
