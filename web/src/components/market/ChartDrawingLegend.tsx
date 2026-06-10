"use client";

import type { LegendItem } from "@/lib/chartDrawingLabels";

export function ChartDrawingLegend({ items }: { items: LegendItem[] }) {
  if (items.length === 0) return null;

  return (
    <div
      className="pointer-events-none absolute bottom-12 start-2 z-10 flex max-w-[min(100%,14rem)] flex-wrap gap-1 rounded-lg border border-border/50 bg-background/85 px-2 py-1.5 backdrop-blur-md"
      aria-label="وسيلة إيضاح الرسم"
    >
      {items.map((item) => (
        <span
          key={item.type}
          className="inline-flex items-center gap-1 text-[10px] text-muted-foreground"
        >
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ backgroundColor: item.color }}
            aria-hidden
          />
          {item.label}
        </span>
      ))}
    </div>
  );
}
