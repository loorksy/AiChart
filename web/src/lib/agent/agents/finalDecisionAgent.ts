import type { AgentDecision, AgentRecommendation, DecisionTrace } from "../types";
import type { EvidenceDimension } from "../evidenceDimensions";
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
  /** Layer 2 of the result contract — how the plan is entered. */
  planType?: "immediate" | "anticipatory" | "conditional";
  /** Layer 3 — whether the plan is actionable right now. */
  executionState?:
    | "valid_now"
    | "awaiting_activation"
    | "expired"
    | "invalidated"
    | "blocked";
  confidence: number;
  confidenceSemantics: ConfidenceSemantics;
  summary: string;
  keyReasons: string[];
  riskWarnings: string[];
  recommendation: AgentRecommendation;
  /**
   * Which timeframe led the decision, which gave context, which timed entry.
   * Present when charts were reviewed — the resolution of any disagreement.
   */
  timeframeRoles?: { lead: string; context: string | null; timing: string | null };
  /** Why this direction and this plan type — operator-readable. */
  decisionTrace?: DecisionTrace;
  /** The evidence card, one grade per dimension, never blended. */
  evidenceDimensions?: EvidenceDimension[];
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
