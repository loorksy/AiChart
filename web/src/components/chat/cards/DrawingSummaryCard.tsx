"use client";
import { CardShell } from "./CardShell";
import type { DrawingSummaryCardPayload } from "@/lib/cards/cardTypes";

export function DrawingSummaryCard({ card, onAction }: { card: DrawingSummaryCardPayload; onAction?: (action: string, payload?: Record<string, unknown>) => void }) {
  const counts = card.drawings.reduce<Record<string, number>>((acc, d) => {
    acc[d.type] = (acc[d.type] ?? 0) + 1;
    return acc;
  }, {});
  return (
    <CardShell title={card.title} actions={card.actions} onAction={onAction}>
      <p className="text-xs text-muted-foreground" dir="ltr">{card.symbol} · {card.timeframe}</p>
      <p className="text-xs">عدد الرسومات: {card.drawings.length}</p>
      <div className="flex flex-wrap gap-1 text-[10px] text-muted-foreground">
        {Object.entries(counts).map(([type, count]) => <span key={type} className="rounded bg-secondary/60 px-2 py-0.5">{type}: {count}</span>)}
      </div>
    </CardShell>
  );
}
