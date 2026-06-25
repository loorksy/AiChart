"use client";

import { Loader2, Radio, X } from "lucide-react";
import { formatLevel } from "@/components/market/formatLevel";
import type { ChartDrawing } from "@/lib/chartDrawings";
import type { Recommendation } from "@/lib/types";
import { cn } from "@/lib/utils";

function parseFactors(rec: Recommendation | null | undefined): string[] {
  if (!rec?.factors) return [];
  try {
    const parsed = JSON.parse(rec.factors) as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export function ChartTradeOverlay({
  recommendation,
  riskReward,
  isAnalyzing,
  liveAnalysis,
  drawings,
  onHighlightDrawing,
  onStopLive,
  onRequestRecommendation,
  className,
}: {
  recommendation?: Recommendation | null;
  riskReward?: number | null;
  isAnalyzing?: boolean;
  liveAnalysis?: boolean;
  drawings?: ChartDrawing[];
  onHighlightDrawing?: (index: number | null) => void;
  onStopLive?: () => void;
  /** Sends a chat message asking for a trade recommendation. */
  onRequestRecommendation?: () => void;
  className?: string;
}) {
  const factors = parseFactors(recommendation);
  const hasTrade =
    recommendation &&
    (recommendation.action === "buy" || recommendation.action === "sell");

  if (!hasTrade && !isAnalyzing && !liveAnalysis && !drawings?.length) {
    return null;
  }

  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-x-2 bottom-2 z-20 flex flex-col items-start gap-1.5 sm:inset-x-auto sm:start-2",
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

      {(hasTrade || isAnalyzing) && (
        <div className="pointer-events-auto w-full max-w-[280px] rounded-xl border border-border/60 bg-card/95 p-3 text-xs shadow-lg backdrop-blur-md sm:w-72">
          {isAnalyzing && !hasTrade ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              <span>جارٍ التحليل…</span>
            </div>
          ) : hasTrade ? (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={cn(
                    "rounded-md px-2 py-0.5 text-[11px] font-semibold",
                    recommendation!.action === "buy"
                      ? "bg-green-500/15 text-green-500"
                      : "bg-red-500/15 text-red-500",
                  )}
                >
                  {recommendation!.action === "buy" ? "شراء" : "بيع"}
                </span>
                <span className="text-muted-foreground">
                  ثقة {recommendation!.confidence}%
                </span>
                {recommendation!.pattern_name && (
                  <span className="rounded-md bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-600 dark:text-amber-400">
                    {recommendation!.pattern_name}
                  </span>
                )}
              </div>

              <div className="grid grid-cols-3 gap-1.5 text-center">
                <div className="rounded-lg bg-secondary/60 px-1 py-1.5">
                  <p className="text-[9px] text-muted-foreground">دخول</p>
                  <p className="font-semibold tabular-nums" dir="ltr">
                    {formatLevel(recommendation!.entry)}
                  </p>
                </div>
                <div className="rounded-lg bg-secondary/60 px-1 py-1.5">
                  <p className="text-[9px] text-muted-foreground">وقف</p>
                  <p
                    className="font-semibold tabular-nums text-red-500"
                    dir="ltr"
                  >
                    {formatLevel(recommendation!.stop_loss)}
                  </p>
                </div>
                <div className="rounded-lg bg-secondary/60 px-1 py-1.5">
                  <p className="text-[9px] text-muted-foreground">هدف</p>
                  <p
                    className="font-semibold tabular-nums text-blue-500"
                    dir="ltr"
                  >
                    {formatLevel(recommendation!.take_profit)}
                  </p>
                </div>
              </div>

              {riskReward != null && (
                <p className="text-[10px] text-muted-foreground">
                  R:R{" "}
                  <span className="font-semibold text-foreground" dir="ltr">
                    1:{riskReward.toFixed(2)}
                  </span>
                </p>
              )}

              {factors.length > 0 && (
                <ul className="max-h-24 space-y-0.5 overflow-y-auto text-[10px] text-muted-foreground">
                  {factors.map((f, i) => (
                    <li
                      key={i}
                      className="cursor-pointer rounded px-1 hover:bg-secondary/80 hover:text-foreground"
                      onClick={() => {
                        const idx = drawings?.findIndex(
                          (d) =>
                            d.label &&
                            f.includes(d.label),
                        );
                        onHighlightDrawing?.(
                          idx != null && idx >= 0 ? idx : null,
                        );
                      }}
                    >
                      • {f}
                    </li>
                  ))}
                </ul>
              )}

              {onRequestRecommendation && (
                <button
                  type="button"
                  onClick={onRequestRecommendation}
                  className="mt-1 w-full rounded-lg border border-primary/40 bg-primary/10 py-1.5 text-[11px] font-medium text-primary hover:bg-primary/20"
                >
                  نفّذ من الدردشة
                </button>
              )}
            </div>
          ) : null}
        </div>
      )}

      {!hasTrade && !isAnalyzing && drawings && drawings.length > 0 && (
        <div className="pointer-events-auto rounded-lg border border-border/50 bg-card/90 px-2 py-1 text-[10px] text-muted-foreground backdrop-blur-md">
          تحليل فني — {drawings.length} عنصر مرسوم
          {onRequestRecommendation && (
            <button
              type="button"
              onClick={onRequestRecommendation}
              className="ms-2 text-primary hover:underline"
            >
              اطلب توصية
            </button>
          )}
        </div>
      )}
    </div>
  );
}
