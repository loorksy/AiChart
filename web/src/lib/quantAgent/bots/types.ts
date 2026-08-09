/**
 * Shared types for the Quant Agent's automated bots.
 *
 * `executionMode` is the owner's per-bot arming switch. Live orders never leave
 * this tree for a venue — see `./brokerPort.ts` and `./liveExecution.ts`.
 *
 * Convention follows `lib/quantAgent/types.ts`: hand-built request/response
 * shapes are camelCase, `*Wire` siblings mirror the service's snake_case and
 * are decoded in `client.ts`.
 *
 * Vocabulary derived from QuantDinger (https://github.com/OpenByteInc/QuantDinger),
 * Copyright Open Byte Inc., licensed under the Apache License, Version 2.0
 * — `backend_api_python/app/services/strategy_runtime/executors.py`. `trend` is
 * absent because upstream has no engine for it, only a parameter schema.
 */
import type { QuantOhlcBar } from "../types";
import type { QuantBotExecutionMode } from "./brokerPort";

export type QuantBotType = "grid" | "dca" | "martingale" | "layered_martingale";

export const QUANT_BOT_TYPES: readonly QuantBotType[] = [
  "grid",
  "dca",
  "martingale",
  "layered_martingale",
] as const;

/** Only grid has a replay engine; the rest preview a ladder and stop there. */
export const QUANT_BOT_SIMULATABLE_TYPES: readonly QuantBotType[] = ["grid"] as const;

export type QuantBotExecutionModeWire = QuantBotExecutionMode;

export type QuantBotSide = "long" | "short" | "neutral";

export interface QuantBotLevel {
  level: number;
  layerIndex: number;
  orderIndex: number;
  action: string;
  side: string;
  price: number;
  amountQuote: number;
  takeProfitPrice: number;
  triggerPct: number;
  scheduledOffsetMinutes: number | null;
  cumulativeAmountQuote: number | null;
}

export interface QuantBotLevelWire {
  level: number;
  layer_index: number;
  order_index: number;
  action: string;
  side: string;
  price: number;
  amount_quote: number;
  take_profit_price: number;
  trigger_pct: number;
  state: string;
  scheduled_offset_minutes?: number;
  cumulative_amount_quote?: number;
}

export interface QuantBotPreviewSummary {
  levelCount: number;
  totalAmountQuote: number;
  longLevelCount: number;
  shortLevelCount: number;
  firstPrice: number;
  lastPrice: number;
}

export interface QuantBotRiskDiagnostic {
  code: string;
  beforeLevel: number;
  basketAverage: number;
  hardStopPrice: number;
  nextLevelPrice: number;
  configuredStopPct: number;
  requiredStopPct: number;
  suggestedStopPct: number;
}

export interface QuantBotPreview {
  executionMode: QuantBotExecutionModeWire;
  status: "ok" | "invalid";
  botType: string;
  config: Record<string, unknown>;
  levels: QuantBotLevel[];
  summary: QuantBotPreviewSummary | null;
  warnings: string[];
  riskDiagnostics: QuantBotRiskDiagnostic[];
  /** Non-empty means the config cannot be saved, only corrected. */
  blockingWarning: string;
  error: string | null;
}

export interface QuantBotPreviewWire {
  execution_mode: QuantBotExecutionModeWire;
  status: "ok" | "invalid";
  bot_type: string;
  config: Record<string, unknown>;
  levels: QuantBotLevelWire[];
  summary: Record<string, number> | null;
  warnings: string[];
  risk_diagnostics: Record<string, unknown>[];
  blocking_warning: string;
  error: string | null;
}

export interface QuantBot {
  id: string;
  ownerUserId: number;
  botType: QuantBotType;
  name: string;
  symbol: string;
  market: string;
  interval: string;
  executionMode: QuantBotExecutionModeWire;
  initialCapital: number;
  feeRate: number;
  config: Record<string, unknown>;
  levels: QuantBotLevel[];
  warnings: string[];
  riskDiagnostics: QuantBotRiskDiagnostic[];
  createdAt: string;
  updatedAt: string;
}

export interface QuantBotWire {
  id: string;
  owner_user_id: number;
  bot_type: QuantBotType;
  name: string;
  symbol: string;
  market: string;
  interval: string;
  execution_mode: QuantBotExecutionModeWire;
  initial_capital: number;
  fee_rate: number;
  config: Record<string, unknown>;
  levels: QuantBotLevelWire[];
  warnings: string[];
  risk_diagnostics: Record<string, unknown>[];
  created_at: string;
  updated_at: string;
}

export interface QuantBotRunLog {
  level: string;
  message: string;
}

export interface QuantBotRun {
  id: string;
  botId: string;
  ownerUserId: number;
  executionMode: QuantBotExecutionModeWire;
  status: "completed" | "invalid";
  barCount: number;
  fromTime: string;
  toTime: string;
  cellsBootstrapped: number;
  ordersPlaced: number;
  fillCount: number;
  matchedCycles: number;
  realizedProfit: number;
  unrealizedProfit: number;
  totalCommission: number;
  endingPrice: number;
  restingOrders: number;
  stopReason: string;
  warnings: string[];
  logs: QuantBotRunLog[];
  cells: Record<string, unknown>[];
  error: string | null;
  createdAt: string;
}

export interface QuantBotRunWire {
  id: string;
  bot_id: string;
  owner_user_id: number;
  execution_mode: QuantBotExecutionModeWire;
  status: "completed" | "invalid";
  bar_count: number;
  from_time: string;
  to_time: string;
  cells_bootstrapped: number;
  orders_placed: number;
  fill_count: number;
  matched_cycles: number;
  realized_profit: number;
  unrealized_profit: number;
  total_commission: number;
  ending_price: number;
  resting_orders: number;
  stop_reason: string;
  warnings: string[];
  logs: QuantBotRunLog[];
  cells: Record<string, unknown>[];
  error: string | null;
  created_at: string;
}

export interface QuantBotFill {
  sequence: number;
  barTime: string;
  cellIndex: number;
  purpose: string;
  price: number;
  quantity: number;
}

export interface QuantBotLedgerEntry {
  sequence: number;
  tradeType: string;
  closeReason: string;
  cellIndex: number;
  price: number;
  amount: number;
  commission: number;
  profit: number | null;
  matchedEntryPrice: number | null;
  gridMatchedProfit: number | null;
}

export interface QuantBotSimulation {
  executionMode: QuantBotExecutionModeWire;
  status: "completed" | "invalid";
  run: QuantBotRun | null;
  fills: QuantBotFill[];
  ledger: QuantBotLedgerEntry[];
  error: string | null;
}

export interface QuantBotSimulationWire {
  execution_mode: QuantBotExecutionModeWire;
  status: "completed" | "invalid";
  run: QuantBotRunWire | null;
  fills: {
    sequence: number;
    bar_time: string;
    cell_index: number;
    purpose: string;
    price: number;
    quantity: number;
  }[];
  ledger: {
    sequence: number;
    trade_type: string;
    close_reason: string;
    cell_index: number;
    price: number;
    amount: number;
    commission: number;
    profit: number | null;
    matched_entry_price: number | null;
    grid_matched_profit: number | null;
  }[];
  error: string | null;
}

export interface PreviewQuantBotParams {
  botType: QuantBotType;
  config: Record<string, unknown>;
}

export interface CreateQuantBotParams {
  botType: QuantBotType;
  name: string;
  symbol: string;
  market: string;
  interval: string;
  initialCapital: number;
  feeRate: number;
  config: Record<string, unknown>;
}

export interface SetQuantBotExecutionModeParams {
  botId: string;
  executionMode: QuantBotExecutionModeWire;
}

export interface SimulateQuantBotParams {
  botId: string;
  bars: QuantOhlcBar[];
}

/**
 * What the LLM bot-config recommender returns, after clamping.
 *
 * Note `botType` can only be one of the four types that have an engine, and
 * `strategyParams` speaks the EXECUTOR vocabulary rather than upstream's dead
 * legacy one — see `./recommendConfig.ts` for why.
 */
export interface QuantBotRecommendation {
  botType: QuantBotType;
  botName: string;
  reason: string;
  baseConfig: {
    symbol: string;
    market: string;
    interval: string;
    marketType: "spot" | "swap";
    leverage: number;
  };
  strategyParams: Record<string, number | string | boolean>;
  riskConfig: {
    equityStopLossPct: number;
    equityTakeProfitPct: number;
  };
}
