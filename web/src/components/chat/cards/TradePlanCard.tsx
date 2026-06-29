"use client";
import { CardShell } from "./CardShell";
import type { TradePlanCardPayload } from "@/lib/cards/cardTypes";

function fmt(v?: number | null) { return v == null ? "—" : v.toLocaleString(undefined, { maximumFractionDigits: 5 }); }

export function TradePlanCard({ card, onAction }: { card: TradePlanCardPayload; onAction?: (action: string, payload?: Record<string, unknown>) => void }) {
  return (
    <CardShell title={card.title} actions={card.actions} onAction={onAction}>
      <div className="flex items-center gap-2 text-xs">
        <span className={card.side === "buy" ? "text-emerald-500" : card.side === "sell" ? "text-red-500" : "text-amber-500"}>{card.side.toUpperCase()}</span>
        <span dir="ltr">{card.symbol} · {card.timeframe}</span>
      </div>
      <div className="grid grid-cols-3 gap-2 text-center text-xs">
        <div className="rounded-lg bg-secondary/50 p-2"><p className="text-muted-foreground">دخول</p><b dir="ltr">{fmt(card.entry)}</b></div>
        <div className="rounded-lg bg-secondary/50 p-2"><p className="text-muted-foreground">وقف</p><b className="text-red-500" dir="ltr">{fmt(card.stopLoss)}</b></div>
        <div className="rounded-lg bg-secondary/50 p-2"><p className="text-muted-foreground">هدف</p><b className="text-emerald-500" dir="ltr">{fmt(card.takeProfits?.[0])}</b></div>
      </div>
      {card.riskReward != null && <p className="text-xs text-muted-foreground">العائد/المخاطرة: <b dir="ltr">1:{card.riskReward.toFixed(2)}</b></p>}
    </CardShell>
  );
}
