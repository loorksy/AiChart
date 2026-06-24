/**
 * Gold Agent X — internal pipeline types.
 */
import type { OhlcCandle } from "@/lib/ohlc/fetchOhlc";
import type { ForexIndicatorsResult } from "@/lib/ohlc/indicators";
import type { StructureAnalysis } from "@/lib/ohlc/structure";
import type {
  GoldAgentXConfig,
  GoldAgentXState,
  GoldSide,
  InstitutionalScoreWeights,
} from "../goldTypes";

export type { GoldSide, GoldAgentXConfig, GoldAgentXState, InstitutionalScoreWeights };

export type AdvisorVoteSide = GoldSide | "hold";
export type MarketRegime =
  | "TRENDING_UP"
  | "TRENDING_DOWN"
  | "RANGE"
  | "BREAKOUT"
  | "VOLATILE"
  | "ACCUMULATION"
  | "DISTRIBUTION"
  | "NEWS_REACTION";

export type DangerLevel = "NORMAL" | "CAUTION" | "DANGER" | "EXTREME_DANGER";
export type AgentDecision = "BUY" | "SELL" | "HOLD" | "CLOSE" | "REVERSE";

export const MARKET_REGIMES: MarketRegime[] = [
  "TRENDING_UP",
  "TRENDING_DOWN",
  "RANGE",
  "BREAKOUT",
  "VOLATILE",
  "ACCUMULATION",
  "DISTRIBUTION",
  "NEWS_REACTION",
];

export interface AdvisorVote {
  advisor: string;
  vote: AdvisorVoteSide;
  confidence: number;
  reason: string;
}

export interface RegimeProbabilities {
  TRENDING_UP: number;
  TRENDING_DOWN: number;
  RANGE: number;
  BREAKOUT: number;
  VOLATILE: number;
  ACCUMULATION: number;
  DISTRIBUTION: number;
  NEWS_REACTION: number;
}

export interface RegimeInfo {
  dominant: MarketRegime;
  probabilities: RegimeProbabilities;
  confidence: number;
  strength: number;
  persistence: number;
}

export type TradingSession =
  | "ASIAN"
  | "LONDON"
  | "NEW_YORK"
  | "LONDON_NY_OVERLAP"
  | "OFF_HOURS";

export interface SessionInfo {
  session: TradingSession;
  quality: number;
  utcHour: number;
}

export interface CorrelationSnapshot {
  symbol: string;
  trend: ForexIndicatorsResult["trend"];
  rsi14: number | null;
  changePct: number;
  available: boolean;
}

export interface CorrelationData {
  dxy: CorrelationSnapshot | null;
  us10y: CorrelationSnapshot | null;
  vix: CorrelationSnapshot | null;
}

export interface MarketContext {
  symbol: string;
  userId: number;
  quote: { bid: number; ask: number; spread: number; mid: number };
  candles: { M1: OhlcCandle[]; M5: OhlcCandle[]; M15: OhlcCandle[] };
  indicators: {
    M1: ForexIndicatorsResult;
    M5: ForexIndicatorsResult;
    M15: ForexIndicatorsResult;
  };
  structure: { M5: StructureAnalysis; M15: StructureAnalysis };
  tickVelocity: number;
  timestamp: number;
  session: SessionInfo;
  correlation: CorrelationData;
}

export interface CouncilResult {
  votes: AdvisorVote[];
  consensusSide: AdvisorVoteSide;
  confidence: number;
  buyWeight: number;
  sellWeight: number;
  holdWeight: number;
}

export interface TradeQualityResult {
  score: number;
  tier: "reject" | "normal" | "strong" | "premium";
  reasons: string[];
}

export interface InstitutionalScoreResult {
  score: number;
  components: Record<string, number>;
}

export interface DecisionResult {
  action: AgentDecision;
  side?: GoldSide;
  confidence: number;
  tradeQuality: number;
  tradeScore: number;
  reason: string;
  blocked?: boolean;
  blockReason?: string;
}

export interface DangerAssessment {
  level: DangerLevel;
  lotMultiplier: number;
  confidenceBoost: number;
  allowEntry: boolean;
  minTradeScoreOverride?: number;
  reason: string;
}

export interface SizingResult {
  lot: number;
  reason: string;
}

export interface ExitResult {
  action: "hold" | "close" | "partial_close" | "reverse";
  reason: string;
  partialPct?: number;
  reverseSide?: GoldSide;
}

export interface SetupMatch {
  fingerprint: string;
  winRate: number;
  samples: number;
  confidenceBoost: number;
}

export interface PerformanceSnapshot {
  winRate: number;
  profitFactor: number;
  expectancy: number;
  totalTrades: number;
  wins: number;
  losses: number;
  avgWin: number;
  avgLoss: number;
  bestSession?: string;
  bestRegime?: string;
  bestAdvisor?: string;
}

export interface MemoryStats {
  patternWins: Record<string, number>;
  patternLosses: Record<string, number>;
  regimeWins: Record<string, number>;
  regimeLosses: Record<string, number>;
  advisorAccuracy: Record<string, { correct: number; total: number }>;
}

export interface TradeJournalEntry {
  botId: number;
  userId: number;
  side: GoldSide;
  entryPrice: number;
  exitPrice: number;
  lot: number;
  pnl: number;
  regime: MarketRegime;
  session: TradingSession;
  confidence: number;
  tradeQuality: number;
  tradeScore: number;
  dangerLevel: DangerLevel;
  advisorVotes: AdvisorVote[];
  weights: Record<string, number>;
  exitReason: string;
  durationMs: number;
  fingerprint: string;
}

export const DEFAULT_INSTITUTIONAL_WEIGHTS: InstitutionalScoreWeights = {
  structure: 0.15,
  momentum: 0.15,
  liquidity: 0.12,
  session: 0.1,
  correlation: 0.1,
  volatility: 0.13,
  memory: 0.1,
  consensus: 0.15,
};

export const ADVISOR_NAMES = [
  "trend",
  "candle",
  "momentum",
  "volatility",
  "fear",
  "opportunity",
  "smartMoney",
  "liquidity",
  "session",
  "correlation",
] as const;

export type AdvisorName = (typeof ADVISOR_NAMES)[number];

export function emptyRegimeProbabilities(): RegimeProbabilities {
  return {
    TRENDING_UP: 0,
    TRENDING_DOWN: 0,
    RANGE: 0,
    BREAKOUT: 0,
    VOLATILE: 0,
    ACCUMULATION: 0,
    DISTRIBUTION: 0,
    NEWS_REACTION: 0,
  };
}

export function clampScore(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}
