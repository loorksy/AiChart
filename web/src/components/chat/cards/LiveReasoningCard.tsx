"use client";
import { CardShell } from "./CardShell";
import type { LiveReasoningCardPayload } from "@/lib/cards/cardTypes";

export function LiveReasoningCard({ card, onAction }: { card: LiveReasoningCardPayload; onAction?: (action: string, payload?: Record<string, unknown>) => void }) {
  return (
    <CardShell title={card.title} actions={card.actions} onAction={onAction}>
      <ul className="space-y-1.5 text-xs text-muted-foreground">
        {card.entries.map((entry, i) => (
          <li key={`${entry.type}-${i}`} className="rounded-lg bg-secondary/40 px-2 py-1">
            <span className="font-semibold text-foreground">{entry.type}</span> · {entry.text}
          </li>
        ))}
      </ul>
    </CardShell>
  );
}
