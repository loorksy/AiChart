"use client";
import { CardShell } from "./CardShell";
import type { PositionCardPayload } from "@/lib/cards/cardTypes";

export function PositionCard({ card, onAction }: { card: PositionCardPayload; onAction?: (action: string, payload?: Record<string, unknown>) => void }) {
  return (
    <CardShell title={card.title} actions={card.actions} onAction={onAction}>
      <p className="text-xs"><b dir="ltr">{card.symbol}</b> · {card.side}</p>
      {card.pnl != null && <p className={card.pnl >= 0 ? "text-emerald-500" : "text-red-500"}>P/L {card.pnl.toFixed(2)}</p>}
    </CardShell>
  );
}
