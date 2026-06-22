/**
 * Pure scalp-session SAFETY guards — no heavy imports, unit-testable in isolation.
 * These enforce limits (auto-stop); they are NOT trade decisions.
 */
import type { MarketType } from "./markets/types";

export interface ScalpStopInputs {
  masterKill: boolean;
  executedCount: number;
  maxTrades: number;
  dailyLossLimitPct: number;
  todayPnlPct: number;
  market: MarketType;
  brokerConnected: boolean;
}

/** Returns an auto-stop reason or null. Priority order matters. */
export function evalScalpStop(inputs: ScalpStopInputs): string | null {
  if (inputs.masterKill) return "master_kill";
  if (inputs.executedCount >= inputs.maxTrades) return "max_trades_reached";
  if (
    inputs.dailyLossLimitPct > 0 &&
    inputs.todayPnlPct <= -Math.abs(inputs.dailyLossLimitPct)
  ) {
    return "daily_loss_limit";
  }
  if (inputs.market === "forex" && !inputs.brokerConnected) {
    return "broker_disconnected";
  }
  return null;
}
