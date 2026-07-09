import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { scorePoi } from "@/lib/agent/trading/scorePoi";
import {
  buildTradeCandidates,
  type BuildTradeCandidatesInput,
} from "@/lib/agent/trading/buildTradeCandidates";
import { computeRangePosition } from "@/lib/agent/marketContext/rangePosition";
import type {
  AgentCandle,
  SupplyDemandZone,
} from "@/lib/agent/marketContext/detectors";
import type { StructureEvent } from "@/lib/agent/marketContext/structureEvents";
import type { LiquiditySweep } from "@/lib/agent/marketContext/liquiditySweeps";

const BAR = 60_000;

function candle(i: number, o: number, h: number, l: number, c: number): AgentCandle {
  return { time: i * BAR, open: o, high: h, low: l, close: c };
}

/**
 * A strong demand scenario: zone at 99–100 formed at t0, strong rally away
 * (no retest), price later at `currentPrice`.
 */
function strongDemandScenario(): {
  candles: AgentCandle[];
  zone: SupplyDemandZone;
} {
  const candles: AgentCandle[] = [candle(0, 100, 100, 99, 99.5)];
  // Strong impulse away: 8 candles rallying to ~106.
  for (let i = 1; i <= 8; i++) {
    const base = 100 + (i - 1) * 0.75;
    candles.push(candle(i, base + 0.05, base + 0.85, base + 0.02, base + 0.75));
  }
  // Consolidation above the zone (never touching it).
  for (let i = 9; i < 60; i++) {
    candles.push(candle(i, 105.2, 106, 104.6, 105.4));
  }
  return { candles, zone: { type: "demand", low: 99, high: 100, time: 0 } };
}

/** Same zone but over-touched: price returns into it repeatedly. */
function overTouchedScenario(): {
  candles: AgentCandle[];
  zone: SupplyDemandZone;
} {
  const { candles, zone } = strongDemandScenario();
  for (const i of [20, 30, 40, 50]) {
    candles[i] = candle(i, 100.5, 100.8, 99.4, 100.2); // dips into 99–100
  }
  return { candles, zone };
}

const BULLISH_BOS: StructureEvent = {
  type: "BOS",
  direction: "bullish",
  brokenLevel: 101,
  breakCandleTime: 3 * BAR,
  confirmationClose: 101.5,
  strength: 70,
  source: "swing",
};

const CONFIRMED_SELL_SIDE_SWEEP: LiquiditySweep = {
  side: "sell_side",
  sweptLevel: 99.2,
  candleTime: 55 * BAR,
  wickExtreme: 98.9,
  closeBackInside: true,
  strength: 75,
  followedByStructureShift: true,
};

function baseInput(
  over: Partial<BuildTradeCandidatesInput> = {},
): BuildTradeCandidatesInput {
  const { candles, zone } = strongDemandScenario();
  return {
    candles,
    currentPrice: 101,
    atr: 0.5,
    trend: "uptrend",
    htfBias: "bullish",
    htfConflict: false,
    zones: [zone],
    structureEvents: [BULLISH_BOS],
    sweeps: [],
    rangePosition: computeRangePosition(candles, over.currentPrice ?? 101),
    htfLevels: [99.5],
    minRr: 1.5,
    newsRisk: "low",
    spread: null,
    ...over,
  };
}

describe("scorePoi", () => {
  it("fresh strong zone with HTF confluence scores high (tradable)", () => {
    const { candles, zone } = strongDemandScenario();
    const score = scorePoi({
      zone,
      candles,
      currentPrice: 101,
      atr: 0.5,
      structureEvents: [BULLISH_BOS],
      sweeps: [],
      rangePosition: computeRangePosition(candles, 101),
      htfLevels: [99.5],
      otherZones: [zone],
    });
    assert.ok(score.score >= 75, `score ${score.score} should be >= 75`);
    assert.ok(score.isTradable);
  });

  it("over-touched zone scores low and is not tradable", () => {
    const { candles, zone } = overTouchedScenario();
    const score = scorePoi({
      zone,
      candles,
      currentPrice: 101,
      atr: 0.5,
      structureEvents: [],
      sweeps: [],
      rangePosition: null,
      htfLevels: [],
      otherZones: [zone],
    });
    assert.ok(score.score < 75, `score ${score.score} should be < 75`);
    assert.equal(score.isTradable, false);
  });

  it("HTF-aligned zone scores higher than the same zone without alignment", () => {
    const { candles, zone } = strongDemandScenario();
    const common = {
      zone,
      candles,
      currentPrice: 101,
      atr: 0.5,
      structureEvents: [] as StructureEvent[],
      sweeps: [] as LiquiditySweep[],
      rangePosition: null,
      otherZones: [zone],
    };
    const aligned = scorePoi({ ...common, htfLevels: [99.5] });
    const notAligned = scorePoi({ ...common, htfLevels: [] });
    assert.ok(aligned.score > notAligned.score);
  });
});

describe("buildTradeCandidates", () => {
  it("strong continuation setup produces a buy candidate", () => {
    const result = buildTradeCandidates(baseInput());
    assert.ok(result.best, "expected a candidate");
    assert.equal(result.best!.action, "buy");
    assert.equal(result.best!.setupType, "trend_continuation");
    assert.ok(result.best!.rr >= 1.5);
    assert.ok(result.best!.invalidationReason.length > 0);
  });

  it("uptrend + WEAK (over-touched) demand = no candidate (WAIT)", () => {
    const { candles, zone } = overTouchedScenario();
    const result = buildTradeCandidates(
      baseInput({ candles, zones: [zone], htfLevels: [] }),
    );
    assert.equal(result.best, null);
    assert.ok(result.rejectedReasons.some((r) => r.includes("قوة")));
  });

  it("trend alone without structure support = no candidate", () => {
    const result = buildTradeCandidates(baseInput({ structureEvents: [] }));
    assert.equal(result.best, null);
    assert.ok(result.rejectedReasons.some((r) => r.includes("كسر هيكل")));
  });

  it("HTF conflict WITHOUT reversal evidence = no candidate (WAIT)", () => {
    const result = buildTradeCandidates(
      baseInput({ htfConflict: true, htfBias: "bearish", sweeps: [] }),
    );
    assert.equal(result.best, null);
    assert.equal(result.hasReversalEvidence, false);
    assert.ok(result.rejectedReasons.some((r) => r.includes("تعارض")));
  });

  it("HTF conflict WITH sweep + structure shift allows a reversal candidate", () => {
    const result = buildTradeCandidates(
      baseInput({
        htfConflict: true,
        htfBias: "bearish",
        sweeps: [CONFIRMED_SELL_SIDE_SWEEP],
      }),
    );
    assert.equal(result.hasReversalEvidence, true);
    assert.ok(result.best, "expected a reversal candidate");
    assert.equal(result.best!.setupType, "reversal_after_sweep");
  });

  it("a sweep ALONE (unconfirmed) is not reversal evidence", () => {
    const result = buildTradeCandidates(
      baseInput({
        htfConflict: true,
        htfBias: "bearish",
        sweeps: [{ ...CONFIRMED_SELL_SIDE_SWEEP, followedByStructureShift: false }],
      }),
    );
    assert.equal(result.hasReversalEvidence, false);
    assert.equal(result.best, null);
  });

  it("mid-range price blocks a continuation candidate", () => {
    const input = baseInput({ currentPrice: 102.5 });
    input.rangePosition = computeRangePosition(input.candles, 102.5);
    assert.equal(input.rangePosition?.label, "mid_range");
    const result = buildTradeCandidates(input);
    assert.equal(result.best, null);
    assert.ok(result.rejectedReasons.some((r) => r.includes("موضع السعر")));
  });

  it("high news risk blocks all candidates", () => {
    const result = buildTradeCandidates(baseInput({ newsRisk: "high" }));
    assert.equal(result.best, null);
    assert.ok(result.rejectedReasons.some((r) => r.includes("إخباري")));
  });

  it("stop inside spread noise blocks the candidate", () => {
    const result = buildTradeCandidates(baseInput({ spread: 0.3 }));
    // risk = 1.0, spread*5 = 1.5 → blocked.
    assert.equal(result.best, null);
    assert.ok(result.rejectedReasons.some((r) => r.includes("السبريد")));
  });
});
