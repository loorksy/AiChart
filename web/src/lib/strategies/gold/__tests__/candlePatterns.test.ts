import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isBullishEngulfing,
  isBearishEngulfing,
  isHammer,
  isShootingStar,
  resolveGoldEntrySignal,
} from "../candlePatterns";
import type { OhlcCandle } from "@/lib/ohlc/fetchOhlc";

function candle(
  open: number,
  high: number,
  low: number,
  close: number,
  time = 1,
): OhlcCandle {
  return { time, open, high, low, close };
}

describe("candlePatterns — engulfing", () => {
  it("detects bullish engulfing", () => {
    const prev = candle(105, 106, 100, 101);
    const curr = candle(100, 108, 99, 107);
    assert.equal(isBullishEngulfing(prev, curr), true);
    const sig = resolveGoldEntrySignal([
      candle(1, 1, 1, 1, 0),
      prev,
      curr,
      candle(108, 109, 107, 108, 4),
    ]);
    assert.equal(sig?.pattern, "bullish_engulfing");
    assert.equal(sig?.side, "buy");
  });

  it("detects bearish engulfing", () => {
    const prev = candle(100, 105, 99, 104);
    const curr = candle(105, 106, 95, 96);
    assert.equal(isBearishEngulfing(prev, curr), true);
    const sig = resolveGoldEntrySignal([
      candle(1, 1, 1, 1, 0),
      prev,
      curr,
      candle(96, 97, 95, 96, 4),
    ]);
    assert.equal(sig?.pattern, "bearish_engulfing");
    assert.equal(sig?.side, "sell");
  });
});

describe("candlePatterns — single candle shapes", () => {
  it("detects hammer as buy", () => {
    const hammer = candle(100, 100.08, 92, 100.05);
    assert.equal(isHammer(hammer), true);
    const sig = resolveGoldEntrySignal([
      candle(1, 1, 1, 1, 0),
      hammer,
      candle(100.1, 100.2, 100, 100.1, 3),
    ]);
    assert.equal(sig?.pattern, "hammer");
    assert.equal(sig?.side, "buy");
  });

  it("detects shooting star as sell", () => {
    const star = candle(100, 108, 99.98, 100.05);
    assert.equal(isShootingStar(star), true);
    const sig = resolveGoldEntrySignal([
      candle(1, 1, 1, 1, 0),
      star,
      candle(101, 102, 100, 101, 3),
    ]);
    assert.equal(sig?.pattern, "shooting_star");
    assert.equal(sig?.side, "sell");
  });
});

describe("candlePatterns — XANDER fallback", () => {
  it("uses last closed body direction when no pattern", () => {
    const neutral = candle(100, 100.5, 99.5, 100.1);
    const sig = resolveGoldEntrySignal([
      candle(1, 1, 1, 1, 0),
      neutral,
      candle(100.2, 100.3, 100, 100.2, 3),
    ]);
    assert.equal(sig?.pattern, "xander_body");
    assert.equal(sig?.side, "buy");
  });

  it("returns null with insufficient candles", () => {
    assert.equal(resolveGoldEntrySignal([]), null);
  });
});
