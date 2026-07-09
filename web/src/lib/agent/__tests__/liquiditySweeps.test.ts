import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  detectLiquiditySweeps,
  enrichSweepsWithStructure,
} from "@/lib/agent/marketContext/liquiditySweeps";
import type { AgentCandle } from "@/lib/agent/marketContext/detectors";

const BAR = 60_000;

function candle(i: number, o: number, h: number, l: number, c: number): AgentCandle {
  return { time: i * BAR, open: o, high: h, low: l, close: c };
}

function flat(n: number): AgentCandle[] {
  return Array.from({ length: n }, (_, i) => candle(i, 100, 100.5, 99.5, 100));
}

describe("liquiditySweeps", () => {
  it("detects a buy-side sweep (wick above equal highs, close back below)", () => {
    const candles = [...flat(10), candle(10, 100, 102.2, 99.9, 100.6)];
    const sweeps = detectLiquiditySweeps({
      candles,
      equalHighs: [{ price: 101.5, time: 4 * BAR }],
      equalLows: [],
      atr: 1,
    });
    assert.equal(sweeps.length, 1);
    assert.equal(sweeps[0]!.side, "buy_side");
    assert.equal(sweeps[0]!.sweptLevel, 101.5);
    assert.equal(sweeps[0]!.closeBackInside, true);
    assert.equal(sweeps[0]!.followedByStructureShift, false);
  });

  it("detects a sell-side sweep (wick below equal lows, close back above)", () => {
    const candles = [...flat(10), candle(10, 100, 100.2, 97.8, 99.4)];
    const sweeps = detectLiquiditySweeps({
      candles,
      equalHighs: [],
      equalLows: [{ price: 98.5, time: 4 * BAR }],
      atr: 1,
    });
    assert.equal(sweeps.length, 1);
    assert.equal(sweeps[0]!.side, "sell_side");
  });

  it("ignores pools that formed AFTER the candle (no lookahead)", () => {
    const candles = [...flat(10), candle(10, 100, 102.2, 99.9, 100.6)];
    const sweeps = detectLiquiditySweeps({
      candles,
      equalHighs: [{ price: 101.5, time: 20 * BAR }], // future pool
      equalLows: [],
      atr: 1,
    });
    assert.equal(sweeps.length, 0);
  });

  it("enrichSweepsWithStructure confirms a sweep followed by opposite CHoCH", () => {
    const candles = [...flat(10), candle(10, 100, 102.2, 99.9, 100.6)];
    const sweeps = detectLiquiditySweeps({
      candles,
      equalHighs: [{ price: 101.5, time: 4 * BAR }],
      equalLows: [],
      atr: 1,
    });
    const enriched = enrichSweepsWithStructure(sweeps, [
      {
        type: "CHoCH",
        direction: "bearish",
        brokenLevel: 99.8,
        breakCandleTime: 12 * BAR,
        confirmationClose: 99.5,
        strength: 70,
        source: "swing",
      },
    ]);
    assert.equal(enriched[0]!.followedByStructureShift, true);
    assert.ok(enriched[0]!.strength > sweeps[0]!.strength);
  });
});
