import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifyHardSafetyFailure,
  decideDeepAnalysisTrigger,
} from "@/lib/agent/deepAnalysis/triggers";
import { buildGeneralizableStrategySpec } from "@/lib/agent/deepAnalysis/strategySpec";
import { scoreCompletedResearchJob } from "@/lib/agent/deepAnalysis/completion";
import {
  composeDeepAnalysisUpdate,
  mapProgressToUxPhase,
} from "@/lib/agent/deepAnalysis/composeUpdate";
import { scoreDnaReliability, scoreShadowReliability } from "@/lib/agent/researchEvidence";
import type { TradingDnaSnapshot } from "@/lib/tradingDna/types";

describe("deepAnalysis triggers", () => {
  it("allows provisional actionable and historical WAIT", () => {
    const provisional = decideDeepAnalysisTrigger({
      decision: "buy",
      confidence: 0.62,
      hardSafetyOrLiveDataFailure: false,
      historicalConfirmationInsufficient: false,
    });
    assert.equal(provisional.run, true);
    assert.equal(provisional.allowReason, "provisional_actionable");

    // Missing history is itself the trigger: a plan the agent issued with no
    // statistical backing is precisely what deep research can strengthen.
    const noHistory = decideDeepAnalysisTrigger({
      decision: "buy",
      confidence: 0.8,
      hardSafetyOrLiveDataFailure: false,
      historicalConfirmationInsufficient: true,
    });
    assert.equal(noHistory.run, true);
    assert.equal(noHistory.allowReason, "insufficient_historical_confirmation");
  });

  it("blocks hard safety and live-data failures", () => {
    const hard = classifyHardSafetyFailure({ stalePrice: true });
    assert.equal(hard.blocked, true);
    const blocked = decideDeepAnalysisTrigger({
      decision: "buy",
      confidence: 0.6,
      hardSafetyOrLiveDataFailure: true,
      hardFailureCode: hard.code,
      historicalConfirmationInsufficient: true,
      userMessage: "please backtest",
    });
    assert.equal(blocked.run, false);
    assert.equal(blocked.blockReason, "stale_price");
  });
});

describe("strategySpec", () => {
  it("refuses numeric-only setups", () => {
    const bad = buildGeneralizableStrategySpec({
      symbol: "EURUSD",
      timeframe: "15m",
      direction: "buy",
      entry: 1.1,
      stopLoss: 1.09,
      targets: [1.12],
      atr: null,
    });
    assert.equal(bad.ok, false);
    if (!bad.ok) assert.equal(bad.reason, "setup_not_generalizable");
  });

  it("builds a Research-valid catalog strategy with relative ATR risk", () => {
    const ok = buildGeneralizableStrategySpec({
      symbol: "EURUSD",
      timeframe: "15m",
      direction: "buy",
      marketRegime: "uptrend",
      zoneType: "demand",
      confirmationRule: "continuation",
      atr: 0.001,
      entry: 1.1,
      stopLoss: 1.098,
      targets: [1.103, 1.106],
    });
    assert.equal(ok.ok, true);
    if (ok.ok) {
      assert.equal(ok.strategySpec.spec_version, "1.0.0");
      assert.equal(ok.strategySpec.direction, "long");
      assert.ok(ok.strategyId);
      assert.ok(ok.fingerprint.includes("EURUSD"));
      assert.ok(ok.strategySpec.entry_conditions);
      assert.equal(ok.strategySpec.long_entry_conditions, undefined);
      assert.equal(ok.strategySpec.short_entry_conditions, undefined);
      assert.equal(
        (ok.strategySpec.stop_loss as { type: string }).type,
        "atr_multiple",
      );
      assert.ok(Array.isArray(ok.strategySpec.targets));
      assert.ok(Array.isArray(ok.strategySpec.symbols));
      assert.equal(ok.strategySpec.market, "forex");
    }
  });
});

describe("confidence reliability", () => {
  it("does not raise confidence from artifact presence alone", () => {
    const scored = scoreCompletedResearchJob({
      status: "succeeded",
      result_summary: "job finished ok",
    });
    assert.equal(scored.delta, 0);
    assert.equal(scored.metricsPresent, false);

    const withMetrics = scoreCompletedResearchJob({
      status: "succeeded",
      result_summary: "win_rate 60 expectancy 0.4 max_drawdown 8 trades 40",
    });
    assert.ok(withMetrics.delta > 0);
    assert.equal(withMetrics.metricsPresent, true);
  });

  it("prefers structured metrics.json fields over summary text", () => {
    const scored = scoreCompletedResearchJob({
      status: "succeeded",
      result_summary: "forex backtest completed: 12 trades",
      metrics: {
        win_rate: 0.62,
        expectancy: 0.35,
        maximum_drawdown_percent: 9,
        trade_count: 40,
      },
    });
    assert.equal(scored.metricsPresent, true);
    assert.ok(scored.delta > 0);
  });

  it("scores DNA from reliability dimensions", () => {
    const snap: TradingDnaSnapshot = {
      snapshotId: "s1",
      userId: 1,
      version: 1,
      generatedAt: Date.now(),
      sampleSize: 40,
      metrics: [
        {
          key: "win_loss_behavior",
          status: "supported",
          value: 0.6,
          sampleSize: 40,
          confidence: 0.8,
          methodology: "test",
          evidence: {
            recommendationIds: [],
            tradeIds: [],
            learningEventIds: [],
            backtestIds: [],
            artifactIds: [],
          },
        },
        {
          key: "confidence_calibration",
          status: "supported",
          value: 0.7,
          sampleSize: 40,
          confidence: 0.7,
          methodology: "test",
          evidence: {
            recommendationIds: [],
            tradeIds: [],
            learningEventIds: [],
            backtestIds: [],
            artifactIds: [],
          },
        },
      ],
      conclusions: [
        {
          id: "1",
          type: "strength",
          text: "good",
          confidence: 0.8,
          evidence: {
            recommendationIds: [],
            tradeIds: [],
            learningEventIds: [],
            backtestIds: [],
            artifactIds: [],
          },
        },
      ],
      evidence: {
        recommendationIds: [],
        tradeIds: [],
        learningEventIds: [],
        backtestIds: [],
        artifactIds: [],
      },
    };
    const scored = scoreDnaReliability(snap);
    assert.ok(scored.delta > 0);
    assert.ok(scored.delta <= 0.08);

    const lowShadow = scoreShadowReliability({
      agrees: true,
      shadowConfidencePct: 20,
    });
    assert.equal(lowShadow.delta, 0);
  });
});

describe("progress UX", () => {
  it("caps phases and never exposes raw progress codes as user text", () => {
    assert.equal(mapProgressToUxPhase("job_created", 0), "start");
    assert.equal(mapProgressToUxPhase("almost_ready", 1), "intermediate");
    assert.equal(mapProgressToUxPhase("almost_ready", 2), null);
    assert.equal(mapProgressToUxPhase("ready", 2), "completion");

    const start = composeDeepAnalysisUpdate({ locale: "ar", phase: "start" });
    assert.doesNotMatch(start.text, /verifying_history|job_created|almost_ready/);
    assert.ok(start.text.includes("أراجع"));
  });
});
