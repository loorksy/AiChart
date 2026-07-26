import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { detectCandlesticks } from "@/lib/chart/geometry/candlesticks";
import { assessPatternStage } from "@/lib/chart/geometry/patternStage";
import type { GeometryCandle } from "@/lib/chart/geometry/types";

const BAR = 60_000;
let seq = 0;

function candle(o: number, h: number, l: number, c: number): GeometryCandle {
  return { time: seq++ * BAR, open: o, high: h, low: l, close: c };
}

/** Filler bars that trend, so context-dependent shapes get their context. */
function trend(from: number, steps: number, step: number): GeometryCandle[] {
  const out: GeometryCandle[] = [];
  let price = from;
  for (let i = 0; i < steps; i++) {
    const next = price + step;
    out.push(candle(price, Math.max(price, next) + 0.1, Math.min(price, next) - 0.1, next));
    price = next;
  }
  return out;
}

describe("candlestick detection", () => {
  it("names a hammer after a decline, not a hanging man", () => {
    const candles = [
      ...trend(100, 6, -1),
      // Long lower wick, small body, closing near the high.
      candle(94, 94.3, 91, 94.1),
    ];
    const signals = detectCandlesticks({ candles, atr: 1 });
    const hammer = signals.find((s) => s.name === "hammer");
    assert.ok(hammer, `expected a hammer, got ${signals.map((s) => s.name).join(", ")}`);
    assert.equal(hammer!.bias, "bullish");
  });

  it("calls the same shape a hanging man after a rally", () => {
    const candles = [...trend(100, 6, 1), candle(106, 106.3, 103, 106.1)];
    const signals = detectCandlesticks({ candles, atr: 1 });
    // Identical geometry, opposite context — the name must follow the context.
    assert.ok(signals.some((s) => s.name === "hanging_man"));
    assert.ok(!signals.some((s) => s.name === "hammer"));
  });

  it("detects a bullish engulfing that swallows the prior body", () => {
    const candles = [
      ...trend(100, 5, -1),
      candle(95, 95.2, 94.2, 94.4),
      candle(94.3, 96.4, 94.2, 96.2),
    ];
    const signals = detectCandlesticks({ candles, atr: 1 });
    const engulfing = signals.find((s) => s.name === "bullish_engulfing");
    assert.ok(engulfing);
    assert.equal(engulfing!.bars, 2);
  });

  it("detects a morning star across three candles", () => {
    const candles = [
      ...trend(100, 5, -1),
      candle(95, 95.1, 93, 93.2),
      candle(93.1, 93.4, 92.8, 93.0),
      candle(93.2, 95.0, 93.1, 94.8),
    ];
    const signals = detectCandlesticks({ candles, atr: 1 });
    const star = signals.find((s) => s.name === "morning_star");
    assert.ok(star);
    assert.equal(star!.bars, 3);
    assert.equal(star!.bias, "bullish");
  });

  it("recognises a doji as indecision rather than a direction", () => {
    const candles = [...trend(100, 5, 1), candle(105, 105.6, 104.4, 105.02)];
    const signals = detectCandlesticks({ candles, atr: 1 });
    const doji = signals.find((s) => s.name === "doji");
    assert.ok(doji);
    assert.equal(doji!.bias, "neutral");
  });

  it("finds nothing in a series too short to judge", () => {
    assert.deepEqual(detectCandlesticks({ candles: [candle(1, 2, 0.5, 1.5)], atr: 1 }), []);
  });

  it("is deterministic", () => {
    const candles = [...trend(100, 8, -1), candle(92, 92.3, 89, 92.1)];
    const a = detectCandlesticks({ candles, atr: 1 });
    const b = detectCandlesticks({ candles, atr: 1 });
    assert.deepEqual(a, b);
  });
});

describe("pattern stage", () => {
  const candles = trend(100, 20, 0.1);

  it("separates a structure barely started from one about to break", () => {
    const early = assessPatternStage({
      status: "forming",
      anchorCount: 1,
      expectedAnchors: 4,
      candles,
      breakLevel: 130, // far above price
      atr: 1,
    });
    const late = assessPatternStage({
      status: "forming",
      anchorCount: 4,
      expectedAnchors: 4,
      candles,
      breakLevel: candles.at(-1)!.close + 0.1, // pressing the boundary
      atr: 1,
    });
    assert.equal(early.stage, "starting");
    assert.equal(late.stage, "near_completion");
    assert.ok(late.completionRatio > early.completionRatio);
  });

  it("distinguishes a fresh break from one with follow-through", () => {
    const justBroke = assessPatternStage({
      status: "completed",
      anchorCount: 4,
      expectedAnchors: 4,
      candles,
      breakIndex: candles.length - 1,
      breakLevel: candles.at(-1)!.close,
      atr: 1,
    });
    assert.equal(justBroke.stage, "completed_unconfirmed");

    const withFollowThrough = assessPatternStage({
      status: "completed",
      anchorCount: 4,
      expectedAnchors: 4,
      candles,
      breakIndex: 5,
      breakLevel: candles[5]!.close,
      atr: 0.2,
    });
    assert.equal(withFollowThrough.stage, "confirmed");
  });

  it("marks an invalidated pattern as failed", () => {
    const failed = assessPatternStage({
      status: "invalidated",
      anchorCount: 4,
      expectedAnchors: 4,
      candles,
      atr: 1,
    });
    assert.equal(failed.stage, "failed");
  });
});
