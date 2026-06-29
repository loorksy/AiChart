"use client";
import { CardShell } from "./CardShell";
import type { AnalysisCardPayload } from "@/lib/cards/cardTypes";

export function AnalysisCard({ card, onAction }: { card: AnalysisCardPayload; onAction?: (action: string, payload?: Record<string, unknown>) => void }) {
  return (
    <CardShell title={card.title} actions={card.actions} onAction={onAction}>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <span>الرمز: <b dir="ltr">{card.symbol}</b></span>
        <span>الفريم: <b>{card.timeframe}</b></span>
        {card.trend && <span>الاتجاه: <b>{card.trend}</b></span>}
        {card.pattern && <span>النموذج: <b>{card.pattern}</b></span>}
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">{card.summary}</p>
    </CardShell>
  );
}
