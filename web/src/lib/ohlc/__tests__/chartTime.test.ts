import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  normalizeCandlesForChart,
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
