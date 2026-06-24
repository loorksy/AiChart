/**
 * Gold Agent X Ultimate — config & state types.
 */
import type {
  AdvisorVote,
  DangerLevel,
  MarketRegime,
  PerformanceSnapshot,
  RegimeProbabilities,
} from "./agentX/types";

export type GoldSide = "buy" | "sell";

export type CandleTimeframe = "M5" | "M15" | "H1";

export type GoldEntryPattern =
  | "bullish_engulfing"
  | "bearish_engulfing"
  | "hammer"
  | "hanging_man"
  | "shooting_star"
  | "xander_body";

export interface GoldEntrySignal {
  side: GoldSide;
  pattern: GoldEntryPattern;
}

export interface InstitutionalScoreWeights {
  structure: number;
  momentum: number;
  liquidity: number;
  session: number;
  correlation: number;
  volatility: number;
  memory: number;
  consensus: number;
}

export interface GoldAgentXConfig {
  /** Base lot size for entries */
  initialLot: number;
  baseLot?: number;
  maxLot: number;
  lotStep: number;
  minConfidence: number;
  maxEquityDrawdownPct: number;
  drawdownTightenPct: number;
  survivalDrawdownPct: number;
  stopLossAtrMult?: number;
  stopLossPips?: number;
  entryTimeframe?: CandleTimeframe;
  correlationSymbols: {
    dxy: string[];
    us10y: string[];
    vix: string[];
  };
  optimizerTradeInterval: number;
  /** Alias for optimizerTradeInterval */
  optimizerIntervalTrades?: number;
  institutionalWeights: InstitutionalScoreWeights;
}

export interface GoldGridLevel {
  price: number;
  lot: number;
  ticket?: number;
  tradeId?: number;
}

export type GoldAgentXPosition = GoldGridLevel & {
  stopLoss?: number;
  entryAt?: string;
};

export interface GoldAgentXState {
  /** Single-position storage (levels[0] when open) */
  levels: GoldGridLevel[];
  entrySide?: GoldSide;
  detectedPattern?: GoldEntryPattern | string;
  startEquity?: number;
  lastActionAt?: string;
  regime?: MarketRegime;
  regimeProbabilities?: RegimeProbabilities;
  advisorVotes?: AdvisorVote[];
  adaptiveWeights?: Record<string, number>;
  confidence?: number;
  tradeQuality?: number;
  tradeScore?: number;
  dangerLevel?: DangerLevel;
  survivalMode?: boolean;
  consecutiveLosses?: number;
  consecutiveWins?: number;
  effectiveMinConfidence?: number;
  executionQualityScores?: number[];
  performance?: PerformanceSnapshot;
  closedTradeCount?: number;
  tradesSinceOptimizer?: number;
  positionBarsHeld?: number;
  lastCycleSummary?: string;
  setupMatch?: string;
}

/** @deprecated legacy grid config */
export interface GoldBotConfig {
  gridStepPips?: number;
  takeProfitPips?: number;
  multiplier?: number;
  maxLevels?: number;
  maxTotalLot?: number;
  maxLotCap?: number;
  candleTimeframe?: string;
  initialLot?: number;
  maxEquityDrawdownPct?: number;
  side?: GoldSide;
}

export type GoldBotState = GoldAgentXState;

export function isLegacyGoldConfig(
  config: GoldBotConfig | GoldAgentXConfig | Record<string, unknown>,
): boolean {
  return (
    "gridStepPips" in config &&
    typeof (config as GoldBotConfig).gridStepPips === "number" &&
    (config as GoldBotConfig).gridStepPips! > 0
  );
}

export function migrateGoldConfig(
  raw: Record<string, unknown>,
): GoldAgentXConfig {
  const { DEFAULT_GOLD_AGENTX_CONFIG } = require("./goldDefaults") as typeof import("./goldDefaults");
  if (isLegacyGoldConfig(raw)) {
    return {
      ...DEFAULT_GOLD_AGENTX_CONFIG,
      initialLot:
        typeof raw.initialLot === "number"
          ? raw.initialLot
          : DEFAULT_GOLD_AGENTX_CONFIG.initialLot,
      maxEquityDrawdownPct:
        typeof raw.maxEquityDrawdownPct === "number"
          ? raw.maxEquityDrawdownPct
          : DEFAULT_GOLD_AGENTX_CONFIG.maxEquityDrawdownPct,
    };
  }
  const merged = { ...DEFAULT_GOLD_AGENTX_CONFIG, ...raw } as GoldAgentXConfig;
  if (merged.baseLot != null && merged.initialLot == null) {
    merged.initialLot = merged.baseLot;
  }
  if (merged.initialLot != null && merged.baseLot == null) {
    merged.baseLot = merged.initialLot;
  }
  if (merged.optimizerIntervalTrades != null && !merged.optimizerTradeInterval) {
    merged.optimizerTradeInterval = merged.optimizerIntervalTrades;
  }
  if (!merged.institutionalWeights) {
    merged.institutionalWeights = DEFAULT_GOLD_AGENTX_CONFIG.institutionalWeights;
  }
  if (!merged.correlationSymbols?.dxy?.length) {
    merged.correlationSymbols = DEFAULT_GOLD_AGENTX_CONFIG.correlationSymbols;
  }
  return merged;
}

export function parseGoldAgentState(raw: Record<string, unknown>): GoldAgentXState {
  const { defaultAdaptiveWeights } = require("./agentX/adaptiveWeights") as typeof import("./agentX/adaptiveWeights");
  const { emptyPerformance } = require("./agentX/performanceEngine") as typeof import("./agentX/performanceEngine");

  return {
    levels: (raw.levels as GoldGridLevel[]) ?? [],
    entrySide: raw.entrySide as GoldSide | undefined,
    detectedPattern:
      typeof raw.detectedPattern === "string" ? raw.detectedPattern : undefined,
    startEquity: typeof raw.startEquity === "number" ? raw.startEquity : undefined,
    lastActionAt: typeof raw.lastActionAt === "string" ? raw.lastActionAt : undefined,
    regime: raw.regime as MarketRegime | undefined,
    regimeProbabilities: raw.regimeProbabilities as RegimeProbabilities | undefined,
    advisorVotes: raw.advisorVotes as AdvisorVote[] | undefined,
    adaptiveWeights:
      (raw.adaptiveWeights as Record<string, number>) ?? defaultAdaptiveWeights(),
    confidence: typeof raw.confidence === "number" ? raw.confidence : undefined,
    tradeQuality: typeof raw.tradeQuality === "number" ? raw.tradeQuality : undefined,
    tradeScore: typeof raw.tradeScore === "number" ? raw.tradeScore : undefined,
    dangerLevel: raw.dangerLevel as DangerLevel | undefined,
    survivalMode: typeof raw.survivalMode === "boolean" ? raw.survivalMode : undefined,
    consecutiveLosses:
      typeof raw.consecutiveLosses === "number" ? raw.consecutiveLosses : 0,
    consecutiveWins:
      typeof raw.consecutiveWins === "number" ? raw.consecutiveWins : 0,
    effectiveMinConfidence:
      typeof raw.effectiveMinConfidence === "number"
        ? raw.effectiveMinConfidence
        : undefined,
    executionQualityScores: raw.executionQualityScores as number[] | undefined,
    performance: (raw.performance as PerformanceSnapshot) ?? emptyPerformance(),
    closedTradeCount:
      typeof raw.closedTradeCount === "number" ? raw.closedTradeCount : 0,
    tradesSinceOptimizer:
      typeof raw.tradesSinceOptimizer === "number" ? raw.tradesSinceOptimizer : 0,
    positionBarsHeld:
      typeof raw.positionBarsHeld === "number" ? raw.positionBarsHeld : 0,
    lastCycleSummary:
      typeof raw.lastCycleSummary === "string" ? raw.lastCycleSummary : undefined,
    setupMatch: typeof raw.setupMatch === "string" ? raw.setupMatch : undefined,
  };
}
