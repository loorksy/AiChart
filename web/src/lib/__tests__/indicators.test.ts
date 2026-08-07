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

describe("local math agrees with the technicalindicators library", () => {
  // The repo runs two math stacks (local + npm). The rsiCrossCheck precedent:
  // any indicator both stacks can compute must agree, or two consumers would
  // show the operator two different numbers for the same chart.
  it("bollinger bands match within a tick", async () => {
    const { BollingerBands } = await import("technicalindicators");
    const values = Array.from({ length: 40 }, (_, i) => 100 + Math.sin(i / 3) * 4 + i * 0.1);
    const lib = BollingerBands.calculate({ period: 20, stdDev: 2, values }).at(-1)!;
    const local = bollinger(values, 20, 2)!;
    assert.ok(Math.abs(lib.middle - local.middle) < 1e-6);
    assert.ok(Math.abs(lib.upper - local.upper) < 1e-6);
    assert.ok(Math.abs(lib.lower - local.lower) < 1e-6);
  });

  it("stochastic %K tracks the library within 2 points", async () => {
    const { Stochastic } = await import("technicalindicators");
    const candles = Array.from({ length: 40 }, (_, i) => ({
      high: 101 + Math.sin(i / 4) * 3,
      low: 99 + Math.sin(i / 4) * 3,
      close: 100 + Math.sin(i / 4) * 3 + Math.cos(i) * 0.5,
    }));
    const lib = Stochastic.calculate({
      high: candles.map((c) => c.high),
      low: candles.map((c) => c.low),
      close: candles.map((c) => c.close),
      period: 14,
      signalPeriod: 3,
    }).at(-1)!;
    // The library's k is raw (unsmoothed); compare against smoothK=1.
    const local = stochastic(candles, 14, 1, 3)!;
    assert.ok(Math.abs(lib.k - local.k) < 2, `lib %K ${lib.k} vs local ${local.k}`);
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
