"use client";
import { CardShell } from "./CardShell";
import type { RiskRewardCardPayload } from "@/lib/cards/cardTypes";

export function RiskRewardCard({ card, onAction }: { card: RiskRewardCardPayload; onAction?: (action: string, payload?: Record<string, unknown>) => void }) {
  return (
    <CardShell title={card.title} actions={card.actions} onAction={onAction}>
      <p className={card.acceptable ? "text-emerald-500" : "text-red-500"}>{card.acceptable ? "الخطة مقبولة مبدئياً" : "الخطة تحتاج مراجعة"}</p>
      {card.riskReward != null && <p className="text-xs text-muted-foreground" dir="ltr">R:R 1:{card.riskReward.toFixed(2)}</p>}
      <p className="text-xs text-muted-foreground">{card.riskText}</p>
    </CardShell>
  );
}
