import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { proposeStructuralTrendline } from "@/lib/agent/drawingCommands/trendlineEvidence";
import type { AgentCandle } from "@/lib/agent/marketContext/detectors";

function candle(
  i: number,
  over: Partial<AgentCandle> = {},
): AgentCandle {
  const base = 100 + Math.sin(i / 8) * 2;
  return {
    time: 1_700_000_000_000 + i * 60_000,
    open: base,
    high: base + 0.4,
    low: base - 0.4,
    close: base + 0.1,
    volume: 100,
    ...over,
  };
}

describe("structural trendline evidence", () => {
  it("rejects short histories", () => {
    const candles = Array.from({ length: 20 }, (_, i) => candle(i));
    const r = proposeStructuralTrendline({
      candles,
      timeframe: "15m",
      atr: 1,
    });
    assert.equal(r.accepted, false);
    assert.match(r.evidence.rejectionReason ?? "", /40/);
  });

  it("rejects adjacent / near-adjacent zigzags as structural", () => {
    // Tiny local zigzag: two lows only 2–3 bars apart.
    const candles = Array.from({ length: 60 }, (_, i) => candle(i));
    candles[20] = candle(20, { low: 90, high: 91, close: 90.5 });
    candles[22] = candle(22, { low: 90.2, high: 91.2, close: 90.7 });
    const r = proposeStructuralTrendline({
      candles,
      timeframe: "15m",
      atr: 2,
    });
    // Either rejected outright, or if somehow accepted must have separation >= 8.
    if (r.accepted) {
      assert.ok(r.evidence.candleSeparation >= 8);
    } else {
      assert.ok(r.evidence.rejectionReason);
    }
  });

  it("accepts a well-separated multi-touch support line", () => {
    const candles: AgentCandle[] = [];
    for (let i = 0; i < 80; i++) {
      // Gentle uptrend with clear swing lows at 10, 30, 50.
      const trend = 100 + i * 0.05;
      const isPivot = i === 10 || i === 30 || i === 50;
      candles.push(
        candle(i, {
          open: trend,
          close: trend + 0.2,
          high: trend + 0.8,
          low: isPivot ? trend - 2.5 : trend - 0.3,
        }),
      );
    }
    // Ensure pivot neighborhood is higher than the pivot low.
    for (const idx of [10, 30, 50]) {
      for (const d of [-3, -2, -1, 1, 2, 3]) {
        const n = candles[idx + d];
        if (!n) continue;
        n.low = Math.max(n.low, candles[idx]!.low + 0.8);
      }
    }
    const r = proposeStructuralTrendline({
      candles,
      timeframe: "15m",
      atr: 1.2,
    });
    assert.equal(r.accepted, true);
    assert.ok(r.evidence.candleSeparation >= 8);
    assert.ok(r.evidence.atrNormalizedDistance >= 0.35);
    assert.ok(r.evidence.independentTouches >= 2);
    assert.equal(r.evidence.anchors.length, 2);
    assert.equal(r.evidence.anchors[0]?.pivot, "swing_low");
  });
});
