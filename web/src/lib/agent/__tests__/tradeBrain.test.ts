import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { scorePoi } from "@/lib/agent/trading/scorePoi";
import {
  buildTradeCandidates,
  stopBuffer,
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
    currentPrice: 100.5,
    atr: 0.5,
    trend: "uptrend",
    htfBias: "bullish",
    htfConflict: false,
    zones: [zone],
    structureEvents: [BULLISH_BOS],
    sweeps: [],
    rangePosition: computeRangePosition(candles, over.currentPrice ?? 100.5),
    htfLevels: [99.5],
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
    assert.ok(result.best!.rr > 0);
    assert.ok(result.best!.invalidationReason.length > 0);
  });

  it("places buy stop loss beyond the demand zone with a real buffer", () => {
    const result = buildTradeCandidates(baseInput());
    assert.ok(result.best, "expected a candidate");
    assert.ok(result.best!.stop_loss < 99);
    assert.ok(
      99 - result.best!.stop_loss >=
        stopBuffer({ symbolPrice: 100.5, spread: null, atr: 0.5 }) - 1e-10,
    );
    assert.equal(result.best!.entryType, "buy_limit");
  });

  it("does not impose a consumed-distance veto", () => {
    const result = buildTradeCandidates(baseInput({ currentPrice: 100.75 }));
    assert.ok(result.best);
    assert.ok(result.best!.rr > 0);
  });

  it("keeps a weak over-touched zone as warned evidence", () => {
    const { candles, zone } = overTouchedScenario();
    const result = buildTradeCandidates(
      baseInput({ candles, zones: [zone], htfLevels: [] }),
    );
    assert.ok(result.best);
    assert.ok(result.best!.warnings.length > 0);
  });

  it("keeps trend-only context as warned evidence", () => {
    const result = buildTradeCandidates(baseInput({ structureEvents: [] }));
    assert.ok(result.best);
    assert.ok(result.best!.warnings.length > 0);
  });

  it("HTF conflict remains evidence and does not erase candidates", () => {
    const result = buildTradeCandidates(
      baseInput({ htfConflict: true, htfBias: "bearish", sweeps: [] }),
    );
    assert.ok(result.best);
    assert.equal(result.hasReversalEvidence, false);
    assert.ok(result.best!.warnings.length > 0);
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
    assert.ok(result.best);
  });

  it("mid-range position does not deterministically block a candidate", () => {
    const input = baseInput({ currentPrice: 102.5 });
    input.rangePosition = computeRangePosition(input.candles, 102.5);
    assert.equal(input.rangePosition?.label, "mid_range");
    const result = buildTradeCandidates(input);
    assert.ok(result.best);
  });

  it("high news risk is a warning and not a candidate veto", () => {
    const result = buildTradeCandidates(baseInput({ newsRisk: "high" }));
    assert.ok(result.best);
    assert.ok(result.best!.warnings.length > 0);
  });

  it("spread noise is a warning and not a market-decision veto", () => {
    const result = buildTradeCandidates(baseInput({ spread: 0.6 }));
    assert.ok(result.best);
    assert.ok(result.best!.warnings.length > 0);
  });
});
