/**
 * Dependency matrix and safe descriptive degradation (RELIABILITY_PLAN.md
 * item 5). Every pipeline stage is classified by WHAT its failure costs, so a
 * degraded run is labelled by policy instead of by scattered ad-hoc checks:
 *
 * - `analysis_critical`  — without it there is no trustworthy answer at all
 *                          (price feed, data integrity) → OPERATIONAL_BLOCKER.
 * - `recommendation_critical` — the answer stands, but no execution-grade
 *                          recommendation may be issued → DESCRIPTIVE_ONLY.
 * - `execution_only`     — affects only the act of executing an already-made
 *                          decision → answer + recommendation stand; execution
 *                          is withheld.
 * - `optional`           — enrichment (news, drawings): the answer continues
 *                          and DECLARES the gap.
 *
 * This module is pure policy: it decides labelling only. It never overrides the
 * model's authority over the direction, never loosens a statistical gate, and never
 * upgrades an outcome — it can only degrade one to a safer state.
 */
import type { AgentStage, AgentStageFailure } from "./errorTaxonomy";
import type { OutcomeClass } from "./resultEnvelope";

export type DependencyClass =
  | "analysis_critical"
  | "recommendation_critical"
  | "execution_only"
  | "optional";

/** Stage → what its failure costs. */
export const DEPENDENCY_MATRIX: Record<AgentStage, DependencyClass> = {
  // Without a price feed / usable candles there is nothing honest to say.
  market_data: "analysis_critical",
  // The decision model IS the answer: no decision → no analysis to report.
  final_decision: "analysis_critical",
  // Transport faults kill the whole exchange.
  transport: "analysis_critical",
  // Risk evidence is required before any execution-grade recommendation.
  risk: "recommendation_critical",
  // Structure/liquidity/S&D/MTF: the answer degrades to descriptive without
  // them — they are the evidence a tradeable call is built on.
  structure: "recommendation_critical",
  liquidity: "recommendation_critical",
  supply_demand: "recommendation_critical",
  multi_timeframe: "recommendation_critical",
  // Guard failures block execution only; the analysis itself stands.
  execution_guard: "execution_only",
  // Enrichment: the answer continues and declares the gap.
  news: "optional",
  drawing: "optional",
  research: "optional",
  general: "optional",
};

export function dependencyClassOf(stage: AgentStage): DependencyClass {
  return DEPENDENCY_MATRIX[stage] ?? "optional";
}

export interface DegradationPolicy {
  /** The strictest outcome the failures allow. Never upgrades an outcome. */
  outcome: OutcomeClass;
  /** May an execution-grade recommendation still be issued? */
  allowsRecommendation: boolean;
  /** May the trade be executed (given every other gate passes)? */
  allowsExecution: boolean;
  /** Stages whose loss the answer must DECLARE to the operator. */
  degradedStages: AgentStage[];
  /** The stage that forced the strictest outcome, when any did. */
  blockingStage?: AgentStage;
}

/**
 * Apply the matrix to a run's captured failures.
 *
 * Precedence is strictly safety-first: one analysis-critical failure blocks,
 * otherwise one recommendation-critical failure downgrades to descriptive,
 * otherwise the answer stands (with any optional gaps declared).
 */
export function evaluateDependencies(
  failures: readonly AgentStageFailure[],
): DegradationPolicy {
  const degradedStages = [...new Set(failures.map((f) => f.stage))];

  const blocking = failures.find(
    (f) => dependencyClassOf(f.stage) === "analysis_critical",
  );
  if (blocking) {
    return {
      outcome: "operational_blocker",
      allowsRecommendation: false,
      allowsExecution: false,
      degradedStages,
      blockingStage: blocking.stage,
    };
  }

  const recommendationBlocker = failures.find(
    (f) => dependencyClassOf(f.stage) === "recommendation_critical",
  );
  if (recommendationBlocker) {
    return {
      outcome: "descriptive_only",
      allowsRecommendation: false,
      allowsExecution: false,
      degradedStages,
      blockingStage: recommendationBlocker.stage,
    };
  }

  const executionBlocker = failures.find(
    (f) => dependencyClassOf(f.stage) === "execution_only",
  );
  return {
    outcome: "descriptive_only",
    allowsRecommendation: true,
    allowsExecution: !executionBlocker,
    degradedStages,
    ...(executionBlocker ? { blockingStage: executionBlocker.stage } : {}),
  };
}

/**
 * Combine the matrix verdict with the evidence-derived outcome. Safety-first:
 * the result is the STRICTER of the two — a policy verdict can pull an outcome
 * down (validated → descriptive → blocker) but never push one up.
 */
export function strictestOutcome(a: OutcomeClass, b: OutcomeClass): OutcomeClass {
  const rank: Record<OutcomeClass, number> = {
    execution_validated: 0,
    descriptive_only: 1,
    operational_blocker: 2,
  };
  return rank[a] >= rank[b] ? a : b;
}
