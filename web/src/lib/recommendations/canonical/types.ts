export const RECOMMENDATION_STATUSES = [
  "draft",
  "active",
  "triggered",
  "partially_closed",
  "tp_hit",
  "sl_hit",
  "expired",
  "cancelled",
  "invalidated",
  "closed",
] as const;

export type RecommendationStatus = (typeof RECOMMENDATION_STATUSES)[number];
export type RecommendationDirection = "buy" | "sell" | "wait";

export const RECOMMENDATION_OUTCOME_TYPES = [
  "TP1",
  "TP2",
  "TP3",
  "SL",
  "BreakEven",
  "Trailing",
  "ManualClose",
  "Expired",
  "Cancelled",
  "Invalidated",
] as const;

export type RecommendationOutcomeType =
  (typeof RECOMMENDATION_OUTCOME_TYPES)[number];

export const RECOMMENDATION_LEARNING_EVENT_TYPES = [
  "RecommendationSucceeded",
  "RecommendationFailed",
  "RecommendationExpired",
  "RecommendationCancelled",
  "RecommendationInvalidated",
  "BreakEvenReached",
  "TrailingActivated",
  "PartialTargetHit",
  "FinalTargetHit",
] as const;

export type RecommendationLearningEventType =
  (typeof RECOMMENDATION_LEARNING_EVENT_TYPES)[number];

export interface CanonicalRecommendation {
  recommendationId: number;
  analysisId?: string;
  sessionId?: string;
  chatId?: string;
  userId: number;
  symbol: string;
  market: string;
  timeframe: string;
  direction: RecommendationDirection;
  entry?: number;
  stopLoss?: number;
  targets: number[];
  risk: Record<string, unknown>;
  confidence: number;
  strategyId: string;
  strategyVersion: string;
  createdAt: number;
  expiresAt: number;
  status: RecommendationStatus;
  statusReason: string;
  source: string;
  engineVersion: string;
  entryType?: string;
  legacyTrackingId?: string;
}

export interface CreateCanonicalRecommendationInput {
  analysisId?: string;
  sessionId?: string;
  chatId?: string;
  userId: number;
  symbol: string;
  market?: string;
  timeframe?: string;
  direction: RecommendationDirection;
  entry?: number | null;
  stopLoss?: number | null;
  targets?: number[];
  risk?: Record<string, unknown>;
  confidence?: number;
  strategyId?: string;
  strategyVersion?: string;
  createdAt?: number;
  expiresAt?: number;
  status?: RecommendationStatus;
  statusReason?: string;
  source?: string;
  engineVersion?: string;
  entryType?: string;
  legacyTrackingId?: string;
  rationale?: string;
  factors?: string[];
  chartDrawingsJson?: string;
  patternName?: string;
  analysisTier?: string;
  contextJson?: string;
}

export interface RecommendationTransition {
  id: number;
  recommendationId: number;
  userId: number;
  fromStatus?: RecommendationStatus;
  toStatus: RecommendationStatus;
  occurredAt: number;
  trigger: string;
  actor: string;
  source: string;
  reason: string;
  metadata: Record<string, unknown>;
}

export interface TransitionRecommendationInput {
  userId: number;
  recommendationId: number;
  toStatus: RecommendationStatus;
  timestamp?: number;
  trigger: string;
  actor: string;
  source: string;
  reason: string;
  metadata?: Record<string, unknown>;
}

export interface RecordRecommendationOutcomeInput {
  userId: number;
  recommendationId: number;
  type: RecommendationOutcomeType;
  occurredAt?: number;
  targetIndex?: 1 | 2 | 3;
  price?: number;
  rMultiple?: number;
  pnl?: number;
  holdingMs?: number;
  mae?: number;
  mfe?: number;
  spreadCost?: number;
  slippage?: number;
  commission?: number;
  riskUsed?: number;
  source: string;
  evidence?: Record<string, unknown>;
  dedupeKey?: string;
}

export interface RecommendationOutcome
  extends Required<
    Pick<
      RecordRecommendationOutcomeInput,
      "userId" | "recommendationId" | "type" | "occurredAt" | "source"
    >
  > {
  id: number;
  targetIndex?: 1 | 2 | 3;
  price?: number;
  rMultiple?: number;
  pnl?: number;
  holdingMs?: number;
  mae?: number;
  mfe?: number;
  spreadCost?: number;
  slippage?: number;
  commission?: number;
  riskUsed?: number;
  evidence: Record<string, unknown>;
}

export interface RecommendationLearningEvent {
  eventId: string;
  recommendationId: number;
  userId: number;
  eventType: RecommendationLearningEventType;
  occurredAt: number;
  sourceOutcomeId?: number;
  payload: Record<string, unknown>;
  evidence: Record<string, unknown>;
}

export type RecommendationHistoryKind =
  | "created"
  | "updated"
  | "drawing_snapshot"
  | "research_revision"
  | "research_completion";

export interface RecommendationHistoryEntry {
  id: number;
  recommendationId: number;
  userId: number;
  kind: RecommendationHistoryKind;
  occurredAt: number;
  actor: string;
  source: string;
  payload: Record<string, unknown>;
}

export class RecommendationLifecycleError extends Error {
  constructor(
    public readonly code:
      | "RECOMMENDATION_NOT_FOUND"
      | "RECOMMENDATION_ILLEGAL_TRANSITION"
      | "RECOMMENDATION_INVALID_INPUT"
      | "RECOMMENDATION_DUPLICATE",
    message: string,
  ) {
    super(message);
    this.name = "RecommendationLifecycleError";
  }
}
