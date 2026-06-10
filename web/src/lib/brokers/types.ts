import type { AgentActivity } from "../agentActivity";
import type { BrokerKind } from "../markets/types";
import type { AdminLimits, TradeIntent, TradingSettings } from "../types";

export interface OrderResult {
  ok: boolean;
  status: "executed" | "failed";
  reason: string;
  tradeId?: number;
  trade?: {
    symbol: string;
    side: string;
    qty: number;
    avg_price: number;
    env: string;
  };
}

export interface PlaceOrderContext {
  intent: TradeIntent;
  settings: TradingSettings;
  limits: AdminLimits;
  /** Effective capital after applying the admin cap. */
  effectiveCapital: number;
  push: (activity: AgentActivity) => void;
}

/**
 * Unified execution backend. `executeIntent` (the risk-gated authority) selects
 * an adapter by the intent's broker and delegates the actual order placement.
 */
export interface BrokerAdapter {
  kind: BrokerKind;
  /** Whether the user currently has a usable connection for this broker. */
  isConnected(userId: number): Promise<boolean>;
  /** Human-readable reason when not connected (for the UI). */
  notConnectedReason(): string;
  /** Places the (already risk-approved) order and records the trade. */
  placeOrder(userId: number, ctx: PlaceOrderContext): Promise<OrderResult>;
}
