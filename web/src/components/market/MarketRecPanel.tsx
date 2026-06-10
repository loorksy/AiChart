"use client";

import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Recommendation } from "@/lib/types";
import { formatLevel } from "./formatLevel";

export function MarketRecPanel({
  open,
  onClose,
  kind,
  rec,
  analysisText,
  isAnalyzing,
  profileLabel,
  contextSummary,
}: {
  open: boolean;
  onClose: () => void;
  kind: "rec" | "analysis";
  rec?: Recommendation | null;
  analysisText?: string;
  isAnalyzing?: boolean;
  profileLabel?: string | null;
  contextSummary?: string[];
}) {
  if (!open) return null;

  const title =
    kind === "rec"
      ? "تفاصيل التوصية"
      : isAnalyzing
        ? "جارٍ التحليل…"
        : "تحليل الذكاء الاصطناعي";

  return (
    <>
      {/* Mobile backdrop */}
      <button
        type="button"
        className="fixed inset-0 z-20 bg-black/40 backdrop-blur-[2px] transition-opacity duration-300 ease-out motion-reduce:transition-none lg:hidden"
        aria-label="إغلاق"
        onClick={onClose}
      />

      <aside
        className={cn(
          "z-30 flex flex-col border-border bg-card text-card-foreground shadow-xl motion-reduce:transition-none",
          "fixed inset-x-0 bottom-0 max-h-[55dvh] rounded-t-2xl border-t transition-transform duration-300 ease-out translate-y-0",
          "lg:static lg:max-h-none lg:w-72 lg:shrink-0 lg:translate-y-0 lg:rounded-xl lg:border lg:shadow-none",
        )}
        role="complementary"
        aria-label={title}
      >
        <div className="flex items-center justify-between border-b border-border/40 px-3 py-2.5">
          <span className="text-xs font-medium text-muted-foreground">{title}</span>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-11 min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-muted-foreground transition hover:bg-secondary hover:text-foreground"
            aria-label="إغلاق"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3 text-sm">
          {kind === "rec" && rec && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={cn(
                    "rounded-lg px-2 py-1 text-xs font-semibold",
                    rec.action === "buy"
                      ? "bg-green-500/15 text-green-500"
                      : "bg-red-500/15 text-red-500",
                  )}
                >
                  {rec.action === "buy" ? "شراء" : "بيع"}
                </span>
                <span className="text-xs text-muted-foreground">
                  ثقة {rec.confidence}%
                </span>
              </div>

              <div className="grid grid-cols-3 gap-2 text-center text-xs">
                <div className="rounded-lg bg-secondary/60 px-2 py-2">
                  <p className="text-muted-foreground">دخول</p>
                  <p className="mt-0.5 font-semibold tabular-nums" dir="ltr">
                    {formatLevel(rec.entry)}
                  </p>
                </div>
                <div className="rounded-lg bg-secondary/60 px-2 py-2">
                  <p className="text-muted-foreground">وقف خسارة</p>
                  <p
                    className="mt-0.5 font-semibold tabular-nums text-red-500"
                    dir="ltr"
                  >
                    {formatLevel(rec.stop_loss)}
                  </p>
                </div>
                <div className="rounded-lg bg-secondary/60 px-2 py-2">
                  <p className="text-muted-foreground">هدف ربح</p>
                  <p
                    className="mt-0.5 font-semibold tabular-nums text-blue-500"
                    dir="ltr"
                  >
                    {formatLevel(rec.take_profit)}
                  </p>
                </div>
              </div>

              {rec.rationale && (
                <p className="leading-relaxed text-foreground">{rec.rationale}</p>
              )}
            </div>
          )}

          {kind === "analysis" && (
            <div className="space-y-3 leading-relaxed text-foreground">
              {profileLabel && (
                <span className="inline-block rounded-lg bg-primary/10 px-2 py-1 text-xs font-medium text-primary">
                  {profileLabel}
                </span>
              )}
              {contextSummary && contextSummary.length > 0 && (
                <ul className="space-y-1 text-xs text-muted-foreground">
                  {contextSummary.map((line) => (
                    <li key={line}>• {line}</li>
                  ))}
                </ul>
              )}
              <div>
                {analysisText || (
                  <span className="text-muted-foreground">جارٍ التحليل…</span>
                )}
                {isAnalyzing && (
                  <span className="ms-1 inline-block h-3 w-1 animate-pulse bg-primary" />
                )}
              </div>
              {!isAnalyzing && analysisText && (
                <p className="text-[10px] text-muted-foreground">
                  سيناريو تنبؤي — ليس ضماناً.
                </p>
              )}
            </div>
          )}
        </div>

        {/* Drag handle hint on mobile */}
        <div
          className="mx-auto mb-2 mt-1 h-1 w-10 shrink-0 rounded-full bg-border lg:hidden"
          aria-hidden
        />
      </aside>
    </>
  );
}
