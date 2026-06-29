"use client";
import { CardShell } from "./CardShell";
import type { MT5OrderTicketCardPayload } from "@/lib/cards/cardTypes";

function fmt(v?: number | null) { return v == null ? "—" : v.toLocaleString(undefined, { maximumFractionDigits: 5 }); }

export function MT5OrderTicketCard({ card, onAction }: { card: MT5OrderTicketCardPayload; onAction?: (action: string, payload?: Record<string, unknown>) => void }) {
  return (
    <CardShell title={card.title} actions={card.actions} onAction={onAction}>
      <p className="text-xs"><b dir="ltr">{card.symbol}</b> · {card.side.toUpperCase()} · {card.orderType}</p>
      <p className="text-xs text-muted-foreground">الاتصال: {card.connectionStatus}</p>
      <div className="grid grid-cols-3 gap-2 text-center text-xs">
        <span>Entry<br/><b dir="ltr">{fmt(card.entry)}</b></span>
        <span>SL<br/><b className="text-red-500" dir="ltr">{fmt(card.stopLoss)}</b></span>
        <span>TP<br/><b className="text-emerald-500" dir="ltr">{fmt(card.takeProfit)}</b></span>
      </div>
    </CardShell>
  );
}
