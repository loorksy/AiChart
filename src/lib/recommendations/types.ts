/**
 * Persistent, server-tracked recommendation model. This is monitoring-only: the
 * tracker never executes trades and never calls an LLM. `status` is the price
 * lifecycle state (for the card's progress bar); `outcome` is the final trade
 * result (drives statistics). A record is TERMINAL when `outcome !== "pending"`.
 */
import type { ActivationRule } from "./activationRule";

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
  /**
   * Numeric id of the canonical recommendations row. `id` above may be a
   * legacy tracking UUID; anything that must BIND to the plan (an auto-executed
   * intent, the revision CAS) uses this, never a parse of `id`.
   */
  canonicalId?: number;
  status: TrackedRecommendationStatus;
  outcome: TrackedRecommendationOutcome;
  setupType?: string;
  rr?: number;
  /** Net TP1 / TP2 R after modelled costs (display-only). */
  netRr?: number;
  netRrTp2?: number;
  activationClass?: "immediate" | "conditional";
  /** How the plan is entered — see the result contract's second layer. */
  planType?: "immediate" | "anticipatory" | "conditional";
  /** Whether the plan can be entered right now — the contract's third layer. */
  executionState?: "valid_now" | "awaiting_activation" | "expired" | "invalidated" | "blocked";
  /** Verified statistical backing, or its absence stated plainly. */
  statisticalSupport?: "strong" | "moderate" | "weak" | "unavailable";
  /** Entry zone bounds, when the plan defines a zone rather than a price. */
  entryLow?: number;
  entryHigh?: number;
  /** What kills the idea, what replaces it, and how long it stays meaningful. */
  invalidationRule?: string;
  alternativeScenario?: string;
  validityCandles?: number;
  /** Which revision of the plan these levels belong to. */
  revisionNo?: number;
  /** Frozen evidence consumed by the brain for the effective revision. */
  evidenceSnapshot?: Record<string, unknown>;
  triggerCondition?: string;
  /**
   * The machine-checkable form of `triggerCondition`. The free text says what
   * the plan waits for; only this decides whether it has happened. A plan
   * carrying one is never activated by a bare price touch.
   */
  activationRule?: ActivationRule;
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
  /** Serialized chart drawings captured with the plan (JSON string). */
  chartDrawingsJson?: string;
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
