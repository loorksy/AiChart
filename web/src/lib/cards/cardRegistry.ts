import type { TradingCardKind } from "@/lib/cards/cardTypes";

export const TRADING_CARD_COMPONENTS: Record<TradingCardKind, string> = {
  analysis: "AnalysisCard",
  live_reasoning: "LiveReasoningCard",
  pattern: "PatternCard",
  trade_plan: "TradePlanCard",
  risk_reward: "RiskRewardCard",
  mt5_order_ticket: "MT5OrderTicketCard",
  position: "PositionCard",
  drawing_summary: "DrawingSummaryCard",
};
