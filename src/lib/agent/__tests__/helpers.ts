/** Shared builders for agent tests — keep test files small and typed. */
import type { StructureResult } from "@/lib/agent/agents/structureAgent";
import type { LiquidityResult } from "@/lib/agent/agents/liquidityAgent";
import type { RiskAgentResult } from "@/lib/agent/agents/riskAgent";
import type { TradeCandidatesResult } from "@/lib/agent/trading/buildTradeCandidates";
import type { TradingPlaybookResult } from "@/lib/agent/trading/tradingPlaybook";
import type { TradeValidationResult } from "@/lib/agent/risk/validateTradeSetup";

export function makeStructure(
  over: Partial<StructureResult> = {},
): StructureResult {
  return {
    trend: "range",
    swings: [],
    support: [],
    resistance: [],
    structureEvents: [],
    latestStructureEvent: null,
    ...over,
  };
}

export function makeLiquidity(
  over: Partial<LiquidityResult> = {},
): LiquidityResult {
  return {
    equalHighs: [],
    equalLows: [],
    nearestBuySide: null,
    nearestSellSide: null,
    sweeps: [],
    latestSweep: null,
    ...over,
  };
}

export function makeCandidatesResult(
  over: Partial<TradeCandidatesResult> = {},
): TradeCandidatesResult {
  return {
    candidates: [],
    best: null,
    rejectedReasons: [],
    hasReversalEvidence: false,
    ...over,
  };
}

export function makePlaybook(
  over: Partial<TradingPlaybookResult> = {},
): TradingPlaybookResult {
  return {
    checklist: [],
    blockingReasons: [],
    warnings: [],
    ...over,
  };
}

export function makeValidation(
  over: Partial<TradeValidationResult> = {},
): TradeValidationResult {
  return { accepted: true, reasons: [], warnings: [], ...over };
}

export function makeRisk(over: Partial<RiskAgentResult> = {}): RiskAgentResult {
  return {
    proposedTrade: { action: "wait" },
    validation: makeValidation(),
    accountWarnings: [],
    selectedCandidate: null,
    candidatesResult: makeCandidatesResult(),
    playbook: makePlaybook(),
    rangePosition: null,
    ...over,
  };
}
