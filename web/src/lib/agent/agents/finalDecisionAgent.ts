import type { AgentDecision, AgentRecommendation } from "../types";
import type { ConfidenceSemantics } from "../confidenceSemantics";

/** The sole model-produced market decision returned by the agent runtime. */
export interface FinalDecisionResult {
  decision: Extract<AgentDecision, "buy" | "sell" | "wait">;
  confidence: number;
  confidenceSemantics: ConfidenceSemantics;
  summary: string;
  keyReasons: string[];
  riskWarnings: string[];
  recommendation: AgentRecommendation;
  /** A short, user-safe evidence trace; never raw chain-of-thought. */
  publicReasoningSummary: string[];
}
