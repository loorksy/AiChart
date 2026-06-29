"use client";
import type { TradingCardPayload } from "@/lib/cards/cardTypes";
import { AnalysisCard } from "./AnalysisCard";
import { LiveReasoningCard } from "./LiveReasoningCard";
import { PatternCard } from "./PatternCard";
import { TradePlanCard } from "./TradePlanCard";
import { RiskRewardCard } from "./RiskRewardCard";
import { MT5OrderTicketCard } from "./MT5OrderTicketCard";
import { PositionCard } from "./PositionCard";
import { DrawingSummaryCard } from "./DrawingSummaryCard";

export function TradingCardRenderer({ card, onAction }: { card: TradingCardPayload; onAction?: (action: string, payload?: Record<string, unknown>) => void }) {
  switch (card.kind) {
    case "analysis": return <AnalysisCard card={card} onAction={onAction} />;
    case "live_reasoning": return <LiveReasoningCard card={card} onAction={onAction} />;
    case "pattern": return <PatternCard card={card} onAction={onAction} />;
    case "trade_plan": return <TradePlanCard card={card} onAction={onAction} />;
    case "risk_reward": return <RiskRewardCard card={card} onAction={onAction} />;
    case "mt5_order_ticket": return <MT5OrderTicketCard card={card} onAction={onAction} />;
    case "position": return <PositionCard card={card} onAction={onAction} />;
    case "drawing_summary": return <DrawingSummaryCard card={card} onAction={onAction} />;
    default: return null;
  }
}
