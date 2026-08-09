import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEPENDENCY_MATRIX,
  dependencyClassOf,
  evaluateDependencies,
  strictestOutcome,
} from "@/lib/agent/dependencyMatrix";
import type { AgentStage, AgentStageFailure } from "@/lib/agent/errorTaxonomy";

function fail(stage: AgentStage): AgentStageFailure {
  return { stage, code: "timeout", retryable: true, operatorDetail: "test" };
}

describe("dependency matrix (item 5)", () => {
  it("classifies the price feed and the decision model as analysis-critical", () => {
    assert.equal(dependencyClassOf("market_data"), "analysis_critical");
    assert.equal(dependencyClassOf("final_decision"), "analysis_critical");
    assert.equal(dependencyClassOf("transport"), "analysis_critical");
  });

  it("classifies evidence stages as recommendation-critical", () => {
    for (const stage of ["risk", "structure", "liquidity", "supply_demand", "multi_timeframe"] as const) {
      assert.equal(dependencyClassOf(stage), "recommendation_critical", stage);
    }
  });

  it("classifies enrichment as optional", () => {
    assert.equal(dependencyClassOf("news"), "optional");
    assert.equal(dependencyClassOf("drawing"), "optional");
    assert.equal(dependencyClassOf("research"), "optional");
  });

  it("every taxonomy stage has a classification (no silent default)", () => {
    const stages: AgentStage[] = [
      "general", "market_data", "structure", "liquidity", "supply_demand",
      "multi_timeframe", "news", "risk", "final_decision", "drawing",
      "execution_guard", "research", "transport",
    ];
    for (const s of stages) {
      assert.ok(DEPENDENCY_MATRIX[s], `stage "${s}" must be classified`);
    }
  });
});

describe("degradation policy", () => {
  it("a clean run allows a recommendation and execution", () => {
    const p = evaluateDependencies([]);
    assert.equal(p.outcome, "descriptive_only");
    assert.equal(p.allowsRecommendation, true);
    assert.equal(p.allowsExecution, true);
    assert.deepEqual(p.degradedStages, []);
  });

  it("an optional loss continues but is DECLARED", () => {
    const p = evaluateDependencies([fail("news")]);
    assert.equal(p.allowsRecommendation, true, "news must never block the answer");
    assert.deepEqual(p.degradedStages, ["news"], "the gap must be declared");
  });

  it("a recommendation-critical loss forbids an execution-grade call", () => {
    for (const stage of ["risk", "structure", "liquidity", "supply_demand", "multi_timeframe"] as const) {
      const p = evaluateDependencies([fail(stage)]);
      assert.equal(p.outcome, "descriptive_only", stage);
      assert.equal(p.allowsRecommendation, false, stage);
      assert.equal(p.allowsExecution, false, stage);
      assert.equal(p.blockingStage, stage);
    }
  });

  it("an analysis-critical loss blocks entirely", () => {
    const p = evaluateDependencies([fail("market_data")]);
    assert.equal(p.outcome, "operational_blocker");
    assert.equal(p.allowsRecommendation, false);
    assert.equal(p.blockingStage, "market_data");
  });

  it("an execution-only loss keeps the recommendation but withholds execution", () => {
    const p = evaluateDependencies([fail("execution_guard")]);
    assert.equal(p.allowsRecommendation, true);
    assert.equal(p.allowsExecution, false);
  });

  it("safety-first precedence: the strictest failure wins", () => {
    const p = evaluateDependencies([fail("news"), fail("risk"), fail("market_data")]);
    assert.equal(p.outcome, "operational_blocker", "a blocker outranks a downgrade");
    assert.equal(p.blockingStage, "market_data");
    assert.equal(p.degradedStages.length, 3, "all losses are still declared");
  });
});

describe("strictestOutcome never upgrades", () => {
  it("picks the safer of two outcomes", () => {
    assert.equal(strictestOutcome("execution_validated", "descriptive_only"), "descriptive_only");
    assert.equal(strictestOutcome("descriptive_only", "operational_blocker"), "operational_blocker");
    assert.equal(strictestOutcome("execution_validated", "execution_validated"), "execution_validated");
    assert.equal(
      strictestOutcome("operational_blocker", "execution_validated"),
      "operational_blocker",
      "a blocker can never be upgraded to validated",
    );
  });
});
