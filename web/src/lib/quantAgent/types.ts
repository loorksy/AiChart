/**
 * Types for the isolated Quant Agent service HTTP contract (FROZEN — see
 * engineering plan §1-2). This is a second, independent decision engine: its
 * recommendations never touch the canonical `recommendations` table and are
 * never routed through `createCanonicalRecommendation` /
 * `applyRecommendationRevision`.
 */

export interface QuantAgentCallerContext {
  userId: number;
  requestId: string;
}

export type QuantDirection = "buy" | "sell";
export type QuantPlanType = "immediate" | "anticipatory" | "conditional";
export type QuantLifecycleState = "active" | "expired" | "invalidated" | "superseded";

/** One OHLC candle assembled by web and pushed to the service (§2 — push model). */
export interface QuantOhlcBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface QuantStrategyDef {
  strategy_id: string;
  version: string;
  display_name: string;
  enabled: boolean;
}

/** Normalized shape used everywhere in web after decoding the wire response. */
export interface QuantRecommendation {
  id: string;
  owner_user_id: number;
  symbol: string;
  market: string;
  interval: string;
  direction: QuantDirection;
  plan_type: QuantPlanType;
  entry: number | null;
  stop_loss: number;
  take_profit: number | null;
  targets: number[];
  confidence: number;
  strategy_id: string;
  strategy_version: string;
  regime: string | null;
  rationale: string;
  evidence: Record<string, unknown>;
  validity_expires_at: string | null;
  lifecycle_state: QuantLifecycleState;
  source_bar_close_time: string;
  created_at: string;
  updated_at: string;
}

/**
 * Wire shape as the service may actually send it — the contract documents
 * both `targets_json`/`targets` and `evidence_json`/`evidence` spellings, so
 * the client accepts either rather than guessing which one shipped.
 */
export interface QuantRecommendationWire {
  id: string;
  owner_user_id: number;
  symbol: string;
  market: string;
  interval: string;
  direction: QuantDirection;
  plan_type: QuantPlanType;
  entry: number | null;
  stop_loss: number;
  take_profit: number | null;
  targets_json?: string | number[] | null;
  targets?: number[] | null;
  confidence: number;
  strategy_id: string;
  strategy_version: string;
  regime?: string | null;
  rationale: string;
  evidence_json?: string | Record<string, unknown> | null;
  evidence?: Record<string, unknown> | null;
  validity_expires_at?: string | null;
  lifecycle_state: QuantLifecycleState;
  source_bar_close_time: string;
  created_at: string;
  updated_at: string;
}

export interface GenerateQuantRecommendationInput {
  symbol: string;
  market: string;
  interval: string;
  bars: QuantOhlcBar[];
}

export interface ListQuantRecommendationsParams {
  symbol?: string;
  state?: QuantLifecycleState | string;
}
