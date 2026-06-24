import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  livePriceConsistent,
  normalizeCandlesForChart,
  sanitizeCandlesForMarket,
  toChartSeconds,
} from "@/lib/ohlc/chartTime";

describe("toChartSeconds", () => {
  it("converts Binance ms to seconds", () => {
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
  it("drops crypto-scale bars on forex chart", () => {
    const forex = [
      { time: 100, open: 1.13, high: 1.14, low: 1.12, close: 1.135 },
      { time: 200, open: 1600, high: 1620, low: 1590, close: 1615 },
    ];
    const out = sanitizeCandlesForMarket(forex, "forex");
    assert.equal(out.length, 1);
    assert.equal(out[0]!.close, 1.135);
  });
});

describe("livePriceConsistent", () => {
  it("rejects cross-market tick", () => {
    assert.equal(livePriceConsistent(1.135, 1615, "forex"), false);
    assert.equal(livePriceConsistent(1.135, 1.136, "forex"), true);
  });
});
