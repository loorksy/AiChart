"use client";

import type { TradeLesson } from "@/lib/types";
import { cn } from "@/lib/utils";

export function MemoryHighlights({ lessons }: { lessons: TradeLesson[] }) {
  if (!lessons.length) {
    return (
      <p className="text-xs text-muted-foreground">
        لا دروس post-mortem بعد — تُولَّد تلقائياً عند إغلاق الصفقات.
      </p>
    );
  }

  return (
    <ul className="space-y-2">
      {lessons.map((l) => (
        <li
          key={l.id}
          className="rounded-lg border border-border/50 bg-card px-2 py-2 text-xs"
        >
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "rounded px-1.5 py-0.5 font-semibold uppercase",
                l.outcome === "win"
                  ? "bg-green-500/15 text-green-600"
                  : l.outcome === "loss"
                    ? "bg-red-500/15 text-red-500"
                    : "bg-secondary text-muted-foreground",
              )}
            >
              {l.outcome}
            </span>
            <span dir="ltr" className="font-medium">
              {l.symbol}
            </span>
          </div>
          <p className="mt-1 leading-relaxed text-foreground">{l.lesson_ar}</p>
        </li>
      ))}
    </ul>
  );
}
