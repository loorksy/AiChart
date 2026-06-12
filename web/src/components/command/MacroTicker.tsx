"use client";

import type { MarketContext } from "@/lib/marketContext";

export function MacroTicker({ context }: { context: MarketContext | null }) {
  if (!context) {
    return (
      <div className="rounded-lg border border-border/60 bg-card px-3 py-2 text-xs text-muted-foreground">
        جارٍ تحميل سياق السوق…
      </div>
    );
  }

  const items = [
    context.fearGreed
      ? `خوف/طمع: ${context.fearGreed.value} (${context.fearGreed.label})`
      : null,
    context.socialHype ? `زخم اجتماعي: ${context.socialHype}` : null,
    ...context.headlines.slice(0, 3).map((h) => h.title),
  ].filter(Boolean);

  return (
    <div className="overflow-hidden rounded-lg border border-border/60 bg-card">
      <div className="flex animate-pulse gap-8 whitespace-nowrap px-3 py-2 text-xs text-muted-foreground motion-reduce:animate-none">
        {items.map((line) => (
          <span key={line}>{line}</span>
        ))}
      </div>
    </div>
  );
}
