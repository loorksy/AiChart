"use client";

import { Eye, Layers, Shield, Sparkles, Target, TrendingUp } from "lucide-react";
import type { LiveReasoningEntry } from "@/lib/analysis/chartAnalyzeLlm";
import { cn } from "@/lib/utils";

const TYPE_ICON: Record<
  LiveReasoningEntry["type"],
  { icon: typeof Eye; className: string }
> = {
  observation: { icon: Eye, className: "text-sky-500" },
  structure: { icon: Layers, className: "text-violet-500" },
  pattern: { icon: Sparkles, className: "text-amber-500" },
  risk: { icon: Shield, className: "text-red-400" },
  decision: { icon: Target, className: "text-primary" },
  drawing: { icon: TrendingUp, className: "text-emerald-500" },
};

export function LiveAnalysisLog({
  entries,
  isAnalyzing,
  waitMessage,
  onHighlightDrawing,
  className,
}: {
  entries?: LiveReasoningEntry[];
  isAnalyzing?: boolean;
  waitMessage?: string;
  onHighlightDrawing?: (index: number | null) => void;
  className?: string;
}) {
  const list = entries ?? [];

  if (!isAnalyzing && list.length === 0 && !waitMessage) return null;

  return (
    <div
      className={cn(
        "rounded-xl border border-border/60 bg-card/95 p-3 text-xs shadow-lg backdrop-blur-md",
        className,
      )}
    >
      <p className="mb-2 text-[11px] font-semibold text-foreground">سجل التحليل الحي</p>

      {isAnalyzing && list.length === 0 && (
        <ul className="space-y-1.5">
          {[1, 2, 3].map((i) => (
            <li
              key={i}
              className="h-4 animate-pulse rounded bg-secondary/60"
              style={{ width: `${70 + i * 8}%` }}
            />
          ))}
        </ul>
      )}

      {waitMessage && (
        <p className="mb-2 text-[10px] text-amber-600 dark:text-amber-400">{waitMessage}</p>
      )}

      {list.length > 0 && (
        <ul className="max-h-36 space-y-1.5 overflow-y-auto">
          {list.map((entry, i) => {
            const meta = TYPE_ICON[entry.type] ?? TYPE_ICON.observation;
            const Icon = meta.icon;
            return (
              <li
                key={`${entry.type}-${i}`}
                className={cn(
                  "flex items-start gap-2 rounded-lg px-1 py-0.5",
                  entry.relatedDrawingIndex != null &&
                    "cursor-pointer hover:bg-secondary/60",
                )}
                onClick={() => {
                  if (entry.relatedDrawingIndex != null) {
                    onHighlightDrawing?.(entry.relatedDrawingIndex);
                  }
                }}
              >
                <Icon className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", meta.className)} />
                <p className="min-w-0 flex-1 leading-snug text-muted-foreground">{entry.text}</p>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
