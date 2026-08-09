import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  livePriceConsistent,
  normalizeCandlesForChart,
  sanitizeCandlesForMarket,
  toChartSeconds,
} from "@/lib/ohlc/chartTime";

describe("toChartSeconds", () => {
  it("converts millisecond timestamps to seconds", () => {
    assert.equal(toChartSeconds(1_700_000_000_000), 1_700_000_000);
  });

  it("passes through Unix seconds", () => {
    assert.equal(toChartSeconds(1_700_000_000), 1_700_000_000);
  });
});

describe("normalizeCandlesForChart", () => {
  it("sorts and filters invalid bars", () => {
    const out = normalizeCandlesForChart([
      { time: 1_700_000_000_000, open: 1, high: 2, low: 0.5, close: 1.5 },
      { time: 1_700_000_060, open: 2, high: 3, low: 1.5, close: 2.5 },
      { time: 0, open: 0, high: 0, low: 0, close: 0 },
    ]);
    assert.equal(out.length, 2);
    assert.equal(out[0]!.time, 1_700_000_000);
    assert.equal(out[1]!.time, 1_700_000_060);
  });
});

describe("sanitizeCandlesForMarket", () => {
  it("drops cross-market-scale bars on forex chart", () => {
    const forex = [
      { time: 100, open: 1.13, high: 1.14, low: 1.12, close: 1.135 },
      { time: 200, open: 1600, high: 1620, low: 1590, close: 1615 },
    ];
    const out = sanitizeCandlesForMarket(forex, "forex");
    assert.equal(out.length, 1);
    assert.equal(out[0]!.close, 1.135);
  });

  it("rejects the reference-scenario 'corrupt' fixture shape (high < low)", async () => {
    // The corrupt_market_data reference scenario (§16) exists to prove the
    // pipeline never invents prices from malformed feed data. This proves the
    // fixture that scenario is built on actually produces bars this real
    // sanitizer rejects — not an ordinary finite candle indistinguishable from
    // a quiet market (which is what the unfixed generator used to emit).
    const { fixtureBars } = await import("@/lib/agent/__tests__/fixtures/referenceScenarioPack");
    const bars = fixtureBars({
      count: 5,
      intervalMs: 5 * 60_000,
      endAt: Date.now(),
      start: 1.1,
      shape: "corrupt",
    });
    assert.ok(bars.every((bar) => bar.high < bar.low), "the fixture must actually be malformed");
    const out = sanitizeCandlesForMarket(bars, "forex");
    assert.equal(
      out.length,
      0,
      "every corrupt bar must be rejected, none silently laundered into a usable candle",
    );
  });
});

describe("livePriceConsistent", () => {
  it("rejects cross-market tick", () => {
    assert.equal(livePriceConsistent(1.135, 1615, "forex"), false);
    assert.equal(livePriceConsistent(1.135, 1.136, "forex"), true);
  });
});
