"use client";
import { CardShell } from "./CardShell";
import type { PatternCardPayload } from "@/lib/cards/cardTypes";

export function PatternCard({ card, onAction }: { card: PatternCardPayload; onAction?: (action: string, payload?: Record<string, unknown>) => void }) {
  return (
    <CardShell title={card.title} actions={card.actions} onAction={onAction}>
      <p className="text-sm font-semibold">{card.pattern}</p>
      {card.confidence != null && <p className="text-xs text-muted-foreground">الثقة: {card.confidence}%</p>}
      {card.points?.length ? <p className="text-xs text-muted-foreground">عدد نقاط النموذج: {card.points.length}</p> : null}
    </CardShell>
  );
}
