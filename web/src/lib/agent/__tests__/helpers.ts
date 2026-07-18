/** Shared builders for agent tests — keep test files small and typed. */
import type { StructureResult } from "@/lib/agent/agents/structureAgent";
import type { LiquidityResult } from "@/lib/agent/agents/liquidityAgent";
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

export function makeValidation(
  over: Partial<TradeValidationResult> = {},
): TradeValidationResult {
  return { accepted: true, reasons: [], warnings: [], ...over };
}
