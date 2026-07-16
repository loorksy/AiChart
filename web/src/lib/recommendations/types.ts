/**
 * Persistent, server-tracked recommendation model. This is monitoring-only: the
 * tracker never executes trades and never calls an LLM. `status` is the price
 * lifecycle state (for the card's progress bar); `outcome` is the final trade
 * result (drives statistics). A record is TERMINAL when `outcome !== "pending"`.
 */
export type TrackedRecommendationStatus =
  | "pending_entry"
  | "triggered"
  | "tp1_hit"
  | "tp2_hit"
  | "tp3_hit"
  | "sl_hit"
  | "invalidated"
  | "expired"
  | "cancelled";

export type TrackedRecommendationOutcome =
  | "pending"
  | "win_tp1"
  | "win_tp2"
  | "win_tp3"
  | "loss"
  | "expired"
  | "cancelled"
  | "invalidated";

export type TrackedDirection = "buy" | "sell";

export type TrackedEntryType = "market" | "limit" | "pending";

export interface TrackedRecommendation {
  id: string;
  userId: number;
  chatId?: string;
  analysisId?: string;
  symbol: string;
  interval: string;
  direction: TrackedDirection;
  entryType: TrackedEntryType;
  entry: number;
  stopLoss: number;
  targets: number[];
  invalidationLevel?: number;
  status: TrackedRecommendationStatus;
  outcome: TrackedRecommendationOutcome;
  setupType?: string;
  rr?: number;
  /** Net TP1 / TP2 R after modelled costs (display-only). */
  netRr?: number;
  netRrTp2?: number;
  activationClass?: "immediate" | "conditional";
  triggerCondition?: string;
  createdAt: number;
  createdCandleTime: number;
  expiresAt: number;
  triggeredAt?: number;
  tp1HitAt?: number;
  tp2HitAt?: number;
  tp3HitAt?: number;
  slHitAt?: number;
  invalidatedAt?: number;
  cancelledAt?: number;
  expiredAt?: number;
  priceAtCreation?: number;
  lastCheckedAt?: number;
}

/** True when a record is finished and must never be re-evaluated. */
export function isTerminalOutcome(outcome: TrackedRecommendationOutcome): boolean {
  return outcome !== "pending";
}

/** True when a target/SL level was actually reached (has a timestamp). */
export function highestTpReached(rec: {
  tp1HitAt?: number;
  tp2HitAt?: number;
  tp3HitAt?: number;
}): 0 | 1 | 2 | 3 {
  if (rec.tp3HitAt) return 3;
  if (rec.tp2HitAt) return 2;
  if (rec.tp1HitAt) return 1;
  return 0;
}
