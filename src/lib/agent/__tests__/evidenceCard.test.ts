import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildEvidenceCard,
  HISTORICAL_DELTA_MAX,
  HISTORICAL_DELTA_MIN,
  scoreHistoricalEvidence,
  summarizeEvidenceCard,
  walkForwardStateFrom,
  type EvidenceCard,
} from "@/lib/agent/evidenceCard";
import { MIN_BACKTEST_TRADES } from "@/lib/strategies/evidence";
import type { StrategyBacktestEvidence, StrategyDeployment } from "@/lib/strategies/evidence";

function backtest(over: Partial<StrategyBacktestEvidence> = {}): StrategyBacktestEvidence {
  return {
    id: 1,
    strategyId: "strat.ema",
    strategyVersion: "v1",
    symbol: "XAUUSD",
    timeframe: "5m",
    jobId: "rj_1",
    status: "eligible",
    tradeCount: 250,
    winRate: 0.55,
    expectancy: 0.2,
    sharpeRatio: 1.1,
    maxDrawdownPct: 8,
    profitFactor: 1.6,
    calibratedConfidence: 55,
    confidenceLow: 48,
    confidenceHigh: 62,
    metrics: {},
    validation: { walk_forward: { passed: true } },
    ...over,
  } as StrategyBacktestEvidence;
}

function deployment(over: Partial<StrategyDeployment> = {}): StrategyDeployment {
  return {
    strategyId: "strat.ema",
    symbol: "XAUUSD",
    timeframe: "5m",
    backtestId: 1,
    state: "shadow",
    expectedWinRate: 0.55,
    calibratedConfidence: 55,
    confidenceLow: 48,
    confidenceHigh: 62,
    liveSampleSize: 0,
    liveWinRate: null,
    suspendedReason: null,
    updatedAt: Date.now(),
    ...over,
  } as StrategyDeployment;
}

describe("walk-forward verdict is read honestly", () => {
  it("distinguishes passed, failed and not evaluated", () => {
    assert.equal(walkForwardStateFrom({ walk_forward: { passed: true } }), "passed");
    assert.equal(walkForwardStateFrom({ walk_forward: { passed: false } }), "failed");
    assert.equal(walkForwardStateFrom({}), "not_evaluated");
    assert.equal(
      walkForwardStateFrom({ walk_forward: {} }),
      "not_evaluated",
      "a present-but-empty blob must never read as passed",
    );
  });
});

describe("evidence card exposes the gates instead of hiding them", () => {
  it("marks a fully validated setup as execution-grade", () => {
    const card = buildEvidenceCard({ backtest: backtest(), deployment: deployment() });
    assert.equal(card.meetsExecutionGates, true);
    assert.equal(card.shortfallReason, null);
    assert.equal(card.tradeCount, 250);
    assert.equal(card.deploymentState, "shadow");
  });

  it("refuses execution grade below the 100-trade gate", () => {
    const card = buildEvidenceCard({
      backtest: backtest({ tradeCount: MIN_BACKTEST_TRADES - 1 }),
      deployment: deployment(),
    });
    assert.equal(card.meetsExecutionGates, false);
    assert.match(card.shortfallReason ?? "", /historical_trades_below_minimum/);
  });

  it("refuses execution grade without a passing walk-forward", () => {
    for (const validation of [{ walk_forward: { passed: false } }, {}]) {
      const card = buildEvidenceCard({
        backtest: backtest({ validation }),
        deployment: deployment(),
      });
      assert.equal(card.meetsExecutionGates, false);
      assert.match(card.shortfallReason ?? "", /walk_forward_/);
    }
  });

  it("refuses execution grade without an approved (or with a suspended) deployment", () => {
    assert.equal(
      buildEvidenceCard({ backtest: backtest(), deployment: null }).shortfallReason,
      "no_approved_deployment",
    );
    assert.equal(
      buildEvidenceCard({
        backtest: backtest(),
        deployment: deployment({ state: "suspended" }),
      }).shortfallReason,
      "deployment_suspended",
    );
  });
});

describe("historical influence stays inside the plan's envelope", () => {
  const gradeCard = (over: Partial<EvidenceCard> = {}): EvidenceCard => ({
    ...buildEvidenceCard({ backtest: backtest(), deployment: deployment() }),
    ...over,
  });

  it("never exceeds the bounds, even with a spectacular backtest", () => {
    const { delta } = scoreHistoricalEvidence(
      gradeCard({ tradeCount: 100_000, profitFactor: 99, confidenceLow: 60, confidenceHigh: 61 }),
    );
    assert.ok(delta <= HISTORICAL_DELTA_MAX, `delta ${delta} must not exceed the cap`);
    assert.ok(delta >= HISTORICAL_DELTA_MIN);
  });

  it("gives ZERO uplift to evidence that failed its gates", () => {
    const card = gradeCard({ meetsExecutionGates: false, shortfallReason: "walk_forward_failed" });
    const { delta } = scoreHistoricalEvidence(card);
    assert.equal(delta, 0, "ungated history must be shown, never scored upward");
  });

  it("a losing backtest earns no uplift", () => {
    const { delta } = scoreHistoricalEvidence(gradeCard({ profitFactor: 0.8 }));
    assert.equal(delta, 0);
  });

  it("scales uplift down for a small sample and a wide interval", () => {
    const big = scoreHistoricalEvidence(
      gradeCard({ tradeCount: 500, confidenceLow: 50, confidenceHigh: 60 }),
    ).delta;
    const small = scoreHistoricalEvidence(
      gradeCard({ tradeCount: 120, confidenceLow: 20, confidenceHigh: 80 }),
    ).delta;
    assert.ok(small < big, "a thin, unstable estimate must count for less");
  });

  it("realised live decay LOWERS confidence even for gated evidence", () => {
    const { delta } = scoreHistoricalEvidence(
      gradeCard({ liveSampleSize: 50, liveWinRate: 0.3, winRate: 0.55 }),
    );
    assert.ok(delta < 0, "live results contradicting history must pull confidence down");
    assert.ok(delta >= HISTORICAL_DELTA_MIN);
  });

  it("applies live decay even when the setup is not execution-grade", () => {
    const card = gradeCard({
      meetsExecutionGates: false,
      shortfallReason: "no_approved_deployment",
      liveSampleSize: 40,
      liveWinRate: 0.2,
      winRate: 0.6,
    });
    assert.ok(scoreHistoricalEvidence(card).delta < 0, "decay is the safe asymmetry");
  });

  it("ignores a live sample too small to mean anything", () => {
    const { delta } = scoreHistoricalEvidence(
      gradeCard({ liveSampleSize: 3, liveWinRate: 0, winRate: 0.6, profitFactor: 1 }),
    );
    assert.equal(delta, 0, "3 live trades must not move confidence");
  });
});

describe("card summary is operator-safe", () => {
  it("states trades and walk-forward in both languages, with no internals", () => {
    const card = buildEvidenceCard({ backtest: backtest(), deployment: deployment({ liveSampleSize: 12 }) });
    const ar = summarizeEvidenceCard(card, "ar");
    const en = summarizeEvidenceCard(card, "en");
    assert.match(ar, /250/);
    assert.match(en, /250 historical trades/);
    assert.match(en, /passed walk-forward/);
    for (const text of [ar, en]) {
      assert.doesNotMatch(text, /backtest|job_|strat\./i, "no internal vocabulary may leak");
    }
  });
});
