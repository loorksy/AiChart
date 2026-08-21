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
      // A PERCENT, the way canonical analytics emits it.
      winRate: (8 / 14) * 100,
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
      winRate: 25,
      averageR: -0.4,
    });
    assert.match(block, /أضعف من المعتاد/);
    // Evidence phrasing only — never an instruction to avoid the symbol.
    assert.doesNotMatch(block, /لا تتداول|تجنّب|توقف/);
  });

  /**
   * The win rate reached this block already scaled to 0-100 and was multiplied
   * by 100 again, so a 60% record was shown to the agent as "6000%" — a
   * fabricated number presented as the user's own history. The earlier fixtures
   * passed a fraction, so they agreed with the bug instead of catching it.
   *
   * Feeding the real analytics output in is what keeps the two sides honest: if
   * either convention ever moves, this fails.
   */
  it("reads the same scale canonical analytics writes", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const analytics = readFileSync(
      resolve(process.cwd(), "src/lib/recommendations/canonical/analytics.ts"),
      "utf8",
    );
    // The producer's formula, verbatim: a percent on 0-100 — and null below
    // the sample-size floor, which the consumer renders as counts only.
    assert.match(
      analytics,
      /completed >= WIN_RATE_SAMPLE_FLOOR \? \(wins \/ completed\) \* 100 : null/,
    );

    // So the consumer must render that number as-is.
    const block = buildScenarioBlock({
      key: "EURUSD",
      total: 10,
      wins: 6,
      losses: 4,
      winRate: 60,
      averageR: 0.5,
    });
    assert.match(block, /نسبة النجاح 60%/);
    assert.doesNotMatch(block, /6000/);
  });
});
