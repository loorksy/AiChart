import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  CANDLE_COVERAGE_POLICY_VERSION,
  DATA_QUALITY_POLICY,
  buildCandleCoverageReport,
  meetsDataQuality,
  resolveCoverageThresholds,
  resolveGapPolicy,
  summarizeCandleGaps,
  worstGapSeverity,
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
      source: "oanda",
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

  describe("gap severity tiers (policy v1.2)", () => {
    afterEach(() => {
      delete process.env.CANDLE_GAP_MAX_SINGLE_BARS;
      delete process.env.CANDLE_GAP_MAX_MISSING_RATIO;
      delete process.env.CANDLE_GAP_CATASTROPHIC_SINGLE_BARS;
      delete process.env.CANDLE_GAP_CATASTROPHIC_RATIO;
    });

    it("scales the missing-bar budget with the inspected window", () => {
      const small = resolveGapPolicy(100);
      const large = resolveGapPolicy(500);
      assert.equal(small.maxSingleGapBars, 3);
      assert.ok(large.maxTotalMissingBars > small.maxTotalMissingBars);
      assert.equal(large.maxTotalMissingBars, 10); // 2% of 500
      assert.equal(large.catastrophicMissingBars, 50); // 10% of 500
    });

    it("classifies isolated missing bars as minor, never critical", () => {
      const gaps = summarizeCandleGaps([{ missingBars: 1 }], 500);
      assert.equal(gaps.gapSeverity, "minor");
      assert.equal(gaps.hasCriticalGaps, false);
      assert.equal(
        meetsDataQuality(
          {
            currentTfCount: 600,
            higherTfCount: 250,
            dailyCount: 120,
            hasCriticalGaps: gaps.hasCriticalGaps,
          },
          "trade",
        ),
        true,
      );
    });

    it("the old blocker case (session-boundary noise) is now significant, not critical", () => {
      // XAUUSD 15m: 20 missing bars across 5 gaps of 4 — the exact pattern the
      // metals daily break used to fabricate. Warns, proceeds.
      const gaps = summarizeCandleGaps(
        Array.from({ length: 5 }, () => ({ missingBars: 4 })),
        500,
      );
      assert.equal(gaps.gapSeverity, "significant");
      assert.equal(gaps.hasCriticalGaps, false);
    });

    it("keeps a catastrophic tier that still blocks", () => {
      assert.equal(
        summarizeCandleGaps([{ missingBars: 60 }], 500).gapSeverity,
        "catastrophic",
      );
      assert.equal(
        summarizeCandleGaps([{ missingBars: 60 }], 500).hasCriticalGaps,
        true,
      );
      // Ratio path: 12 missing in a 100-bar window ≥ 10%.
      assert.equal(
        summarizeCandleGaps(
          Array.from({ length: 4 }, () => ({ missingBars: 3 })),
          100,
        ).gapSeverity,
        "catastrophic",
      );
    });

    it("honours env overrides", () => {
      process.env.CANDLE_GAP_MAX_SINGLE_BARS = "1";
      process.env.CANDLE_GAP_MAX_MISSING_RATIO = "0.001";
      const gaps = summarizeCandleGaps([{ missingBars: 2 }], 500);
      assert.equal(gaps.gapSeverity, "significant");
      process.env.CANDLE_GAP_CATASTROPHIC_SINGLE_BARS = "5";
      assert.equal(
        summarizeCandleGaps([{ missingBars: 6 }], 500).gapSeverity,
        "catastrophic",
      );
    });

    it("worstGapSeverity orders the ladder correctly", () => {
      assert.equal(worstGapSeverity(["none", "minor"]), "minor");
      assert.equal(
        worstGapSeverity(["minor", "significant", "none"]),
        "significant",
      );
      assert.equal(
        worstGapSeverity(["significant", "catastrophic"]),
        "catastrophic",
      );
    });
  });

  it("significant gaps warn but no longer fail the coverage gates", () => {
    const report = buildCandleCoverageReport({
      analysisKind: "intraday",
      currentInterval: "15m",
      higherInterval: "1h",
      currentTfCount: 600,
      higherTfCount: 250,
      dailyCount: 120,
      gaps: {
        current: Array.from({ length: 5 }, () => ({ missingBars: 4 })),
      },
    });

    assert.equal(report.gapSeverity, "significant");
    assert.notEqual(report.status, "gapped");
    assert.equal(report.hasCriticalGaps, false);
    assert.equal(report.sufficientForAnalysis, true);
    assert.equal(report.sufficientForTrade, true);
    assert.match(report.summaryEn, /repair started/i);
    assert.match(report.summaryAr, /الإصلاح التلقائي/);
  });

  it("blocks every coverage gate only on catastrophic data loss", () => {
    const report = buildCandleCoverageReport({
      analysisKind: "intraday",
      currentInterval: "15m",
      higherInterval: "1h",
      currentTfCount: 600,
      higherTfCount: 250,
      dailyCount: 120,
      gaps: {
        current: [{ missingBars: 60 }],
      },
    });

    assert.equal(report.status, "gapped");
    assert.equal(report.gapSeverity, "catastrophic");
    assert.equal(report.hasCriticalGaps, true);
    assert.equal(report.sufficientForAnalysis, false);
    assert.equal(report.sufficientForTrade, false);
    assert.equal(report.sufficientForDrawing, false);
    assert.equal(report.timeframes[0]?.missingBars, 60);
    assert.match(report.summaryEn, /catastrophic.*repair started/i);
  });
});
