export const TRADING_DNA_METRIC_KEYS = [
  "risk_tolerance",
  "average_r",
  "average_holding_time",
  "mae",
  "mfe",
  "win_loss_behavior",
  "preferred_sessions",
  "preferred_symbols",
  "preferred_timeframes",
  "preferred_strategies",
  "break_even_behavior",
  "trailing_behavior",
  "risk_scaling",
  "drawdown_recovery",
  "confidence_calibration",
  "execution_consistency",
  "portfolio_concentration",
  "backtest_coverage",
] as const;

export type TradingDnaMetricKey = (typeof TRADING_DNA_METRIC_KEYS)[number];
export type EvidenceStatus = "supported" | "insufficient_evidence";

export interface EvidenceReferences {
  recommendationIds: number[];
  tradeIds: number[];
  learningEventIds: string[];
  backtestIds: string[];
  artifactIds: string[];
}

export interface TradingDnaMetric {
  key: TradingDnaMetricKey;
  status: EvidenceStatus;
  value?: number | string | Record<string, unknown> | Array<Record<string, unknown>>;
  unit?: string;
  sampleSize: number;
  confidence: number;
  methodology: string;
  evidence: EvidenceReferences;
}

export type TradingDnaConclusionType =
  | "strength"
  | "weakness"
  | "pattern"
  | "risk_profile"
  | "strategy_profile"
  | "confidence_profile"
  | "improvement";

export interface TradingDnaConclusion {
  id: string;
  type: TradingDnaConclusionType;
  text: string;
  confidence: number;
  evidence: EvidenceReferences;
}

export interface TradingDnaSnapshot {
  snapshotId: string;
  userId: number;
  version: number;
  generatedAt: number;
  windowStart?: number;
  windowEnd?: number;
  sampleSize: number;
  metrics: TradingDnaMetric[];
  conclusions: TradingDnaConclusion[];
  evidence: EvidenceReferences;
}

export type TradingPersonaName =
  | "scalper"
  | "intraday"
  | "swing"
  | "trend"
  | "mean_reversion"
  | "hybrid"
  | "unclassified";

export interface TradingPersonaVersion {
  personaId: string;
  userId: number;
  version: number;
  snapshotId: string;
  persona: TradingPersonaName;
  confidence: number;
  sampleSize: number;
  rationale: string;
  evidence: EvidenceReferences;
  createdAt: number;
}

export interface BacktestEvidenceReference {
  jobId: string;
  userId: number;
  verifiedAt: number;
  artifactIds: string[];
  jobType: "run_forex_backtest" | "run_backtest_validation";
  status: "succeeded";
  resultSummary?: string;
}

export interface TradingDnaRecommendationEvidence {
  recommendationId: number;
  symbol: string;
  market: string;
  timeframe: string;
  strategyId: string;
  direction: "buy" | "sell" | "wait";
  confidence: number;
  status: string;
  createdAt: number;
}

export interface TradingDnaOutcomeEvidence {
  outcomeId: number;
  recommendationId: number;
  type: string;
  rMultiple?: number;
  pnl?: number;
  holdingMs?: number;
  mae?: number;
  mfe?: number;
  spreadCost?: number;
  slippage?: number;
  commission?: number;
  riskUsed?: number;
  occurredAt: number;
}

export interface TradingDnaLearningEvidence {
  eventId: string;
  recommendationId: number;
  eventType: string;
  occurredAt: number;
}

export interface TradingDnaTradeEvidence {
  tradeId: number;
  recommendationId?: number;
  symbol: string;
  status: string;
  pnl: number;
  createdAt: number;
  closedAt?: number;
}

export interface TradingDnaLessonEvidence {
  lessonId: number;
  recommendationId: number;
  fingerprint: string;
  strategyId: string;
  market: string;
  confidence: number;
  sampleSize: number;
  evidenceEventIds: string[];
}

export interface TradingDnaEvidenceBundle {
  userId: number;
  collectedAt: number;
  recommendations: TradingDnaRecommendationEvidence[];
  outcomes: TradingDnaOutcomeEvidence[];
  learningEvents: TradingDnaLearningEvidence[];
  trades: TradingDnaTradeEvidence[];
  lessons: TradingDnaLessonEvidence[];
  backtests: BacktestEvidenceReference[];
}

export type ShadowDirection = "buy" | "sell" | "wait";

export interface ShadowRecommendation {
  shadowRecommendationId: string;
  userId: number;
  snapshotId: string;
  sourceRecommendationId?: number;
  symbol: string;
  timeframe: string;
  direction: ShadowDirection;
  confidence: number;
  rationale: string[];
  evidence: EvidenceReferences;
  researchOnly: true;
  executionProhibited: true;
  createdAt: number;
}

export interface TradingDnaReport {
  schemaVersion: "aichart-trading-dna-report-v1";
  generatedAt: number;
  snapshot: TradingDnaSnapshot;
  persona: TradingPersonaVersion;
  strengths: TradingDnaConclusion[];
  weaknesses: TradingDnaConclusion[];
  patterns: TradingDnaConclusion[];
  riskProfile: TradingDnaConclusion[];
  strategyProfile: TradingDnaConclusion[];
  confidenceProfile: TradingDnaConclusion[];
  improvementSuggestions: TradingDnaConclusion[];
}

export function emptyEvidence(): EvidenceReferences {
  return {
    recommendationIds: [],
    tradeIds: [],
    learningEventIds: [],
    backtestIds: [],
    artifactIds: [],
  };
}
