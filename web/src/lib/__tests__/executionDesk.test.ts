import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assessSetup, DESK_WEIGHTS } from "@/lib/executionDesk";
import {
  computeRewardRisk,
  getEffectiveMinRr,
  DEFAULT_MIN_RR,
} from "@/lib/riskGuard";
import type { TradingSettings } from "@/lib/types";

describe("computeRewardRisk", () => {
  it("computes reward/risk for a long", () => {
    assert.equal(computeRewardRisk(100, 90, 120), 2); // reward 20 / risk 10
  });
  it("computes reward/risk for a short", () => {
    assert.equal(computeRewardRisk(100, 110, 80), 2); // reward 20 / risk 10
  });
  it("returns null when a price is missing", () => {
    assert.equal(computeRewardRisk(100, null, 120), null);
    assert.equal(computeRewardRisk(null, 90, 120), null);
    assert.equal(computeRewardRisk(100, 90, null), null);
  });
  it("returns null for a zero-width stop", () => {
    assert.equal(computeRewardRisk(100, 100, 120), null);
  });
});

describe("getEffectiveMinRr", () => {
  it("falls back to default when unset", () => {
    assert.equal(getEffectiveMinRr({} as TradingSettings), DEFAULT_MIN_RR);
  });
  it("uses the configured value", () => {
    assert.equal(getEffectiveMinRr({ min_rr: 2 } as TradingSettings), 2);
  });
  it("ignores invalid values", () => {
    assert.equal(
      getEffectiveMinRr({ min_rr: NaN } as unknown as TradingSettings),
      DEFAULT_MIN_RR,
    );
  });
});

describe("executionDesk.assessSetup — deterministic committee", () => {
  const bullish = {
    side: "buy" as const,
    timeframes: [
      { tf: "1h", rsi: 62, macdHist: 0.5, price: 105, sma: 100 },
      { tf: "15m", rsi: 58, macdHist: 0.2, price: 104, sma: 101 },
    ],
    entry: 105,
    stopLoss: 100,
    takeProfit: 120,
  };

  it("returns four scores in 0..100 and a weighted finalScore", () => {
    const a = assessSetup(bullish);
    for (const s of [a.trend, a.breakout, a.meanReversion, a.risk]) {
      assert.ok(s.score >= 0 && s.score <= 100);
    }
    const expected = Math.round(
      a.trend.score * DESK_WEIGHTS.trend +
        a.breakout.score * DESK_WEIGHTS.breakout +
        a.meanReversion.score * DESK_WEIGHTS.meanReversion +
        a.risk.score * DESK_WEIGHTS.risk,
    );
    assert.equal(a.finalScore, expected);
  });

  it("scores trend high for a long aligned with bullish structure", () => {
    const a = assessSetup(bullish);
    assert.ok(a.trend.score >= 70);
  });

  it("scores trend high for a short aligned with bearish structure", () => {
    const a = assessSetup({
      side: "sell",
      timeframes: [
        { tf: "1h", rsi: 38, macdHist: -0.5, price: 95, sma: 100 },
        { tf: "15m", rsi: 42, macdHist: -0.2, price: 96, sma: 99 },
      ],
      entry: 95,
      stopLoss: 100,
      takeProfit: 80,
    });
    assert.ok(a.trend.score >= 70);
  });

  it("flags a missing stop and a weak R:R", () => {
    const a = assessSetup({
      side: "buy",
      timeframes: [{ tf: "1h", rsi: 55, price: 100, sma: 99 }],
      entry: 100,
      stopLoss: null,
      takeProfit: 101,
      minRr: 1,
    });
    assert.equal(a.flags.hasStop, false);
    // rr is null (no stop) → rrOk true by convention; risk score penalized for no stop
    assert.ok(a.risk.score < 70);
  });

  it("marks rrOk false when target is closer than stop", () => {
    const a = assessSetup({
      side: "buy",
      timeframes: [{ tf: "1h", rsi: 55, price: 100, sma: 99 }],
      entry: 100,
      stopLoss: 90,
      takeProfit: 105,
      minRr: 1,
    });
    assert.equal(a.flags.rr, 0.5);
    assert.equal(a.flags.rrOk, false);
  });

  it("flags stale quotes and wide spreads", () => {
    const a = assessSetup({
      side: "buy",
      timeframes: [{ tf: "1h", rsi: 55, price: 100, sma: 99 }],
      entry: 100,
      stopLoss: 95,
      takeProfit: 115,
      spreadPct: 0.02,
      maxSpreadPct: 0.005,
      quoteAgeMs: 9000,
      staleQuoteMs: 5000,
    });
    assert.equal(a.flags.spreadOk, false);
    assert.equal(a.flags.quoteFresh, false);
  });

  it("handles missing indicators without throwing", () => {
    const a = assessSetup({ timeframes: [] });
    assert.ok(Number.isFinite(a.finalScore));
  });
});
