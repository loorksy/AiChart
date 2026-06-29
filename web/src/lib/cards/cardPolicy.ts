import type { TradingCardPayload } from "@/lib/cards/cardTypes";

const MAX_DEFAULT = 2;

function priority(card: TradingCardPayload): number {
  switch (card.kind) {
    case "mt5_order_ticket": return 100;
    case "trade_plan": return 90;
    case "risk_reward": return 80;
    case "position": return 75;
    case "pattern": return 70;
    case "drawing_summary": return 65;
    case "live_reasoning": return 55;
    case "analysis": return 50;
    default: return 0;
  }
}

export function selectTradingCards(cards: TradingCardPayload[], max = MAX_DEFAULT): TradingCardPayload[] {
  const byKind = new Map<string, TradingCardPayload>();
  for (const card of cards) {
    const prev = byKind.get(card.kind);
    if (!prev || priority(card) > priority(prev)) byKind.set(card.kind, card);
  }
  const sorted = [...byKind.values()].sort((a, b) => priority(b) - priority(a));
  const hasTicket = sorted.some((c) => c.kind === "mt5_order_ticket");
  if (hasTicket) return sorted.filter((c) => c.kind === "mt5_order_ticket").slice(0, 1);
  const hasTradePlan = sorted.some((c) => c.kind === "trade_plan");
  if (hasTradePlan) return sorted.filter((c) => c.kind === "trade_plan" || c.kind === "risk_reward").slice(0, max);
  return sorted.slice(0, max);
}
