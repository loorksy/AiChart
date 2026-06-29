import type { ChartDrawing } from "@/lib/chartDrawings";
import type { LiveReasoningEntry } from "@/lib/analysis/chartAnalyzeLlm";

export type TradingCardKind =
  | "analysis"
  | "live_reasoning"
  | "pattern"
  | "trade_plan"
  | "risk_reward"
  | "mt5_order_ticket"
  | "position"
  | "drawing_summary";

export interface CardActionDescriptor {
  action: string;
  label: string;
  variant?: "primary" | "secondary" | "danger" | "ghost";
  payload?: Record<string, unknown>;
}

export interface TradingCardBase<T extends TradingCardKind = TradingCardKind> {
  id: string;
  kind: T;
  title: string;
  actions?: CardActionDescriptor[];
}

export interface AnalysisCardPayload extends TradingCardBase<"analysis"> {
  symbol: string;
  timeframe: string;
  trend?: string;
  support?: number | null;
  resistance?: number | null;
  pattern?: string | null;
  summary: string;
}

export interface LiveReasoningCardPayload extends TradingCardBase<"live_reasoning"> {
  entries: LiveReasoningEntry[];
}

export interface PatternCardPayload extends TradingCardBase<"pattern"> {
  pattern: string;
  confidence?: number;
  drawingIndex?: number;
  points?: Array<{ time?: number; price: number }>;
}

export interface TradePlanCardPayload extends TradingCardBase<"trade_plan"> {
  symbol: string;
  timeframe: string;
  side: "buy" | "sell" | "wait";
  entry?: number | null;
  stopLoss?: number | null;
  takeProfits?: number[];
  riskReward?: number | null;
}

export interface RiskRewardCardPayload extends TradingCardBase<"risk_reward"> {
  riskReward?: number | null;
  acceptable: boolean;
  riskText: string;
}

export interface MT5OrderTicketCardPayload extends TradingCardBase<"mt5_order_ticket"> {
  symbol: string;
  orderType: "market" | "limit";
  side: "buy" | "sell";
  lotSize?: number | null;
  riskAmount?: number | null;
  entry?: number | null;
  stopLoss: number;
  takeProfit?: number | null;
  connectionStatus: "online" | "offline" | "unknown";
}

export interface PositionCardPayload extends TradingCardBase<"position"> {
  symbol: string;
  side: string;
  pnl?: number | null;
  stopLoss?: number | null;
  takeProfit?: number | null;
  positionId?: string | number;
}

export interface DrawingSummaryCardPayload extends TradingCardBase<"drawing_summary"> {
  symbol: string;
  timeframe: string;
  drawings: ChartDrawing[];
  canSendToMt5?: boolean;
}

export type TradingCardPayload =
  | AnalysisCardPayload
  | LiveReasoningCardPayload
  | PatternCardPayload
  | TradePlanCardPayload
  | RiskRewardCardPayload
  | MT5OrderTicketCardPayload
  | PositionCardPayload
  | DrawingSummaryCardPayload;
