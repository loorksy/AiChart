import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CANDLE_COVERAGE_POLICY_VERSION,
  DATA_QUALITY_POLICY,
  buildCandleCoverageReport,
  meetsDataQuality,
  resolveCoverageThresholds,
} from "@/lib/agent/dataQualityPolicy";

describe("candle coverage policy", () => {
  it("keeps distinct analysis/trade/drawing gates", () => {
    assert.ok(DATA_QUALITY_POLICY.trade.currentTf > DATA_QUALITY_POLICY.analysis.currentTf);
    assert.deepEqual(DATA_QUALITY_POLICY.trade, DATA_QUALITY_POLICY.drawing);
  });

  it("varies preferred depth by analysis kind", () => {
    const scalp = resolveCoverageThresholds("scalp", "analysis");
    const swing = resolveCoverageThresholds("swing", "trade");
    assert.ok(scalp.currentTf < DATA_QUALITY_POLICY.analysis.currentTf);
    assert.ok(swing.currentTf > DATA_QUALITY_POLICY.trade.currentTf);
  });

  it("reports exact available/required counts and refill status", () => {
    const report = buildCandleCoverageReport({
      analysisKind: "intraday",
      currentInterval: "15m",
      higherInterval: "1h",
      currentTfCount: 64,
      higherTfCount: 40,
      dailyCount: 20,
      source: "warehouse+oanda",
      refill: {
        current: { attempted: true, inserted: 18, failed: false },
        higher: { attempted: true, inserted: 0, failed: true },
        daily: { attempted: false, inserted: 0, failed: false },
      },
    });
    assert.equal(report.policyVersion, CANDLE_COVERAGE_POLICY_VERSION);
    assert.equal(report.sufficientForTrade, false);
    assert.equal(report.timeframes[0]?.available, 64);
    assert.equal(report.timeframes[0]?.required, 500);
    assert.equal(report.timeframes[0]?.refillAttempted, true);
    assert.match(report.summaryEn, /64\/500/);
    assert.match(report.summaryAr, /64\/500/);
    assert.ok(["insufficient", "refill_required", "refill_failed", "degraded_but_usable"].includes(report.status));
  });

  it("marks coverage sufficient when trade gate is met", () => {
    const report = buildCandleCoverageReport({
      analysisKind: "intraday",
      currentInterval: "15m",
      higherInterval: "1h",
      currentTfCount: 600,
      higherTfCount: 250,
      dailyCount: 120,
    });
    assert.equal(report.sufficientForTrade, true);
    assert.equal(report.status, "sufficient");
    assert.equal(
      meetsDataQuality(
        { currentTfCount: 600, higherTfCount: 250, dailyCount: 120 },
        "trade",
      ),
      true,
    );
  });
});
