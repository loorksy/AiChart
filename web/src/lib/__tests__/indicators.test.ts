import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { adx, bollinger, macd, rsi, stochastic } from "@/lib/indicators";

function candle(h: number, l: number, c: number) {
  return { high: h, low: l, close: c };
}

describe("bollinger", () => {
  it("computes bands and %B on a known window", () => {
    // 20 closes ending in a rally: last close should sit high in the band.
    const values = Array.from({ length: 20 }, (_, i) => 100 + i * 0.5);
    const bb = bollinger(values, 20, 2)!;
    assert.ok(bb.upper > bb.middle && bb.middle > bb.lower);
    assert.ok(bb.percentB > 0.8, `%B ${bb.percentB} should be near the top`);
    assert.ok(bb.widthPct > 0);
  });

  it("flat prices give zero width and centered %B", () => {
    const bb = bollinger(Array(20).fill(50), 20, 2)!;
    assert.equal(bb.upper, bb.lower);
    assert.equal(bb.percentB, 0.5);
    assert.equal(bb.widthPct, 0);
  });

  it("returns null without enough data", () => {
    assert.equal(bollinger([1, 2, 3], 20), null);
  });
});

describe("stochastic", () => {
  it("closes at the top of the range read near 100, at the bottom near 0", () => {
    const rising = Array.from({ length: 30 }, (_, i) =>
      candle(101 + i, 99 + i, 101 + i),
    );
    const top = stochastic(rising)!;
    assert.ok(top.k > 85, `%K ${top.k} should be high in an uptrend closing on highs`);

    const falling = Array.from({ length: 30 }, (_, i) =>
      candle(200 - i, 198 - i, 198 - i),
    );
    const bottom = stochastic(falling)!;
    assert.ok(bottom.k < 15, `%K ${bottom.k} should be low closing on lows`);
    assert.ok(bottom.d >= 0 && bottom.d <= 100);
  });

  it("returns null without enough candles", () => {
    assert.equal(stochastic([candle(1, 0, 1)]), null);
  });
});

describe("adx", () => {
  it("a persistent one-way trend scores much higher than a flat chop", () => {
    const trend = Array.from({ length: 60 }, (_, i) =>
      candle(101 + i, 99 + i, 100.8 + i),
    );
    // Alternating up/down bars around a flat mean — directionless.
    const chop = Array.from({ length: 60 }, (_, i) =>
      i % 2 === 0 ? candle(101, 99, 100.5) : candle(101.2, 98.8, 99.5),
    );
    const strong = adx(trend)!;
    const weak = adx(chop)!;
    assert.ok(strong > 60, `trend ADX ${strong} should be strong`);
    assert.ok(weak < 25, `chop ADX ${weak} should be weak`);
    assert.ok(strong <= 100 && weak >= 0);
  });

  it("returns null without 2×period+1 candles", () => {
    assert.equal(adx(Array(20).fill(candle(1, 0, 1))), null);
  });
});

describe("existing indicators stay coherent with the new ones", () => {
  it("rsi and macd still behave on a monotone series", () => {
    const values = Array.from({ length: 60 }, (_, i) => 100 + i);
    assert.equal(rsi(values), 100);
    const m = macd(values)!;
    assert.ok(m.macd > 0 && m.histogram >= -1e-9);
  });
});
