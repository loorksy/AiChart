import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildScenarioBlock,
  SCENARIO_MIN_OBSERVATIONS,
} from "@/lib/agent/memory/scenarioMemory";

describe("L2 scenario block", () => {
  it("renders the realized record as traceable facts", () => {
    const block = buildScenarioBlock({
      key: "XAUUSD",
      total: 14,
      wins: 8,
      losses: 6,
      winRate: 8 / 14,
      averageR: 1.83,
    });
    assert.match(block, /XAUUSD/);
    assert.match(block, /14 توصية مكتملة/);
    assert.match(block, /8 رابحة و6 خاسرة/);
    assert.match(block, /57%/);
    assert.match(block, /1\.83R/);
    // A healthy record carries no weakness note.
    assert.doesNotMatch(block, /أضعف من المعتاد/);
  });

  it("flags a weak symbol record as evidence, without advice", () => {
    const block = buildScenarioBlock({
      key: "GBPJPY",
      total: SCENARIO_MIN_OBSERVATIONS + 3,
      wins: 2,
      losses: 6,
      winRate: 0.25,
      averageR: -0.4,
    });
    assert.match(block, /أضعف من المعتاد/);
    // Evidence phrasing only — never an instruction to avoid the symbol.
    assert.doesNotMatch(block, /لا تتداول|تجنّب|توقف/);
  });
});
