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

/**
 * Entry types and their fill semantics live in entrySemantics.ts. The legacy
 * "limit"/"pending" spellings are kept so stored rows still parse; new plans
 * use the explicit four.
 */
export type TrackedEntryType =
  | "market"
  | "limit"
  | "pending"
  | "limit_touch"
  | "confirmation_close"
  | "retest_zone";

export interface TrackedRecommendation {
  id: string;
  userId: number;
  chatId?: string;
  analysisId?: string;
  symbol: string;
  interval: string;
  direction: TrackedDirection;
  entryType: TrackedEntryType;
  /** Nominal price. For confirmation_close this is the TRIGGER level, not the fill. */
  entry: number;
  /**
   * The price the plan is actually graded on once filled. Equals `entry` for
   * market/limit fills; for confirmation_close it is the confirming candle's
   * close. R multiples and RR must read this, never `entry`.
   */
  effectiveEntry?: number;
  /** Fill band for retest_zone entries. */
  retestZone?: { from: number; to: number } | null;
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
  /**
   * Which brain produced the decision: 'platform_agent' (the platform's own
   * synthesizer) or 'mcp_client' (an external model thinking through MCP).
   * Statistics group on this — mixing the two would corrupt the platform
   * agent's own performance record.
   */
  decisionSource?: string;
  /** The model behind the decision when known; null = not declared, never guessed. */
  decisionModel?: string | null;
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
