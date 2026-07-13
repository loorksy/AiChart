/**
 * Gold Agent X — single-tick decision pipeline.
 */
import type { GoldAgentXConfig, GoldAgentXState } from "../goldTypes";
import { defaultAdaptiveWeights } from "./adaptiveWeights";
import { runCouncil } from "./council";
import { assessDanger } from "./dangerEngine";
import { makeDecision } from "./decisionEngine";
import { evaluateDrawdownControl } from "./drawdownController";
import { averageExecutionQuality } from "./executionQuality";
import { computeInstitutionalScore } from "./institutionalScore";
import { analyzeMarket } from "./marketAnalysis";
import { emptyMemory, updateMemoryFromTrade } from "./memory";
import { emptyPerformance, updatePerformance } from "./performanceEngine";
import { computeRegimeProbabilities, detectRegime } from "./regimeProbability";
import { matchSetup, fingerprintSetup, type StoredSetup } from "./setupLibrary";
import { computePositionSize } from "./sizing";
import { evaluateSurvivalMode } from "./survivalMode";
import { scoreTradeQuality } from "./tradeQualityEngine";
import type {
  CouncilResult,
  DecisionResult,
  MarketContext,
  RegimeInfo,
  SetupMatch,
} from "./types";

export interface AgentXCycleInput {
  userId: number;
  botId: number;
  config: GoldAgentXConfig;
  state: GoldAgentXState;
  quote: { bid: number; ask: number };
  prevMid?: number;
  setupLibrary?: StoredSetup[];
}

export interface AgentXCycleResult {
  state: GoldAgentXState;
  ctx: MarketContext;
  regime: RegimeInfo;
  council: CouncilResult;
  decision: DecisionResult;
  setupMatch: SetupMatch | null;
  lot: number;
  drawdownPct: number;
}

function floatingPnl(
  side: "buy" | "sell",
  entry: number,
  lot: number,
  quote: { bid: number; ask: number },
): number {
  const close = side === "sell" ? quote.ask : quote.bid;
  return side === "sell" ? (entry - close) * lot : (close - entry) * lot;
}

export async function runAgentXCycle(
  input: AgentXCycleInput,
): Promise<AgentXCycleResult> {
  const { config, quote } = input;
  let state: GoldAgentXState = {
    ...input.state,
    adaptiveWeights: {
      ...defaultAdaptiveWeights(),
      ...input.state.adaptiveWeights,
    },
  };

  const ctx = await analyzeMarket(input.userId, quote, config, input.prevMid);
  const probabilities = computeRegimeProbabilities(ctx);
  const regime = detectRegime(ctx, probabilities, state.regime);
  const weights = state.adaptiveWeights ?? defaultAdaptiveWeights();
  const council = runCouncil(ctx, regime, weights);
  const quality = scoreTradeQuality(ctx, regime, council);
  const memory = emptyMemory(); // extended via state in engine
  const institutional = computeInstitutionalScore(
    ctx,
    regime,
    council,
    quality,
    config,
    memory,
  );

  const startEquity = state.startEquity ?? 10_000;
  const position = state.levels[0];
  let drawdownPct = 0;
  if (position && startEquity > 0) {
    const unrealized = floatingPnl(
      state.entrySide ?? "buy",
      position.price,
      position.lot,
      quote,
    );
    if (unrealized < 0) drawdownPct = (-unrealized / startEquity) * 100;
  }

  const ddControl = evaluateDrawdownControl(
    config,
    state.consecutiveLosses ?? 0,
    drawdownPct,
    config.minConfidence,
  );

  const survival = evaluateSurvivalMode(
    config,
    state.consecutiveLosses ?? 0,
    drawdownPct,
    state.survivalMode ?? false,
    state.consecutiveWins ?? 0,
  );

  const danger = assessDanger(ctx, regime);
  const execAvg = averageExecutionQuality(state.executionQualityScores);

  const fp = fingerprintSetup(ctx, regime, council);
  const setupMatch = matchSetup(fp, input.setupLibrary ?? []);

  const decision = makeDecision({
    council,
    tradeQuality: quality.score,
    tradeScore: institutional.score,
    config,
    effectiveMinConfidence: ddControl.effectiveMinConfidence + survival.confidenceBoost,
    danger,
    hasPosition: (state.levels?.length ?? 0) > 0,
    positionSide: state.entrySide,
    setupMatch,
    survivalBlocked: survival.blockNewEntries,
  });

  const sizing = computePositionSize({
    config,
    confidence: decision.confidence,
    tradeQuality: quality.score,
    tradeScore: institutional.score,
    regime,
    atr: ctx.indicators.M5.atr14 ?? 2,
    drawdownPct,
    survivalMultiplier: survival.lotMultiplier * ddControl.lotMultiplier,
    danger,
    executionQualityAvg: execAvg,
  });

  state = {
    ...state,
    regime: regime.dominant,
    regimeProbabilities: probabilities,
    advisorVotes: council.votes,
    confidence: decision.confidence,
    tradeQuality: quality.score,
    tradeScore: institutional.score,
    dangerLevel: danger.level,
    survivalMode: survival.active,
    effectiveMinConfidence: ddControl.effectiveMinConfidence,
    setupMatch: setupMatch?.fingerprint,
    lastCycleSummary: `${regime.dominant} · ${decision.action} · Q${quality.score} S${institutional.score}`,
  };

  return {
    state,
    ctx,
    regime,
    council,
    decision,
    setupMatch,
    lot: sizing.lot,
    drawdownPct,
  };
}

export { updateMemoryFromTrade, updatePerformance, emptyPerformance };
