import type { AgentDecision, AgentRecommendation } from "../types";
import type { ConfidenceSemantics } from "../confidenceSemantics";
import type { RiskAgentResult } from "./riskAgent";
import type { NewsMacroResult } from "./newsMacroAgent";
import type { AgentMarketContext } from "../marketContext/buildAgentMarketContext";
import type { StructureResult } from "./structureAgent";
import type { SupplyDemandResult } from "./supplyDemandAgent";
import type { MultiTimeframeResult } from "./multiTimeframeAgent";
import type { ChartDrawing } from "@/lib/chartDrawings";

/** The sole model-produced market decision returned by the agent runtime. */
export interface FinalDecisionResult {
  decision: Exclude<AgentDecision, "informational" | "action_required">;
  confidence: number;
  confidenceSemantics: ConfidenceSemantics;
  summary: string;
  keyReasons: string[];
  riskWarnings: string[];
  recommendation: AgentRecommendation;
  /** A short, user-safe evidence trace; never raw chain-of-thought. */
  publicReasoningSummary: string[];
}

/** Structured evidence supplied to the sole final-decision model. */
export interface FinalDecisionInput {
  userMessage: string;
  risk: RiskAgentResult | null;
  news: NewsMacroResult | null;
  market: AgentMarketContext;
  structure: StructureResult | null;
  supplyDemand: SupplyDemandResult | null;
  mtf: MultiTimeframeResult | null;
  chartDrawings?: ChartDrawing[];
}
