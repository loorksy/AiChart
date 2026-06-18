import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import {
  clearEaQuoteTickMetrics,
  gapToBucket,
  getEaQuoteTickMetrics,
  recordEaQuoteTickGap,
} from "../eaQuoteMetrics";
import { updateEaLiveQuotes } from "../eaLiveState";

describe("eaQuoteMetrics", () => {
  beforeEach(() => {
    clearEaQuoteTickMetrics();
  });

  it("maps gaps to histogram buckets", () => {
    assert.equal(gapToBucket(500), "0-1000");
    assert.equal(gapToBucket(1500), "1000-3000");
    assert.equal(gapToBucket(4000), "3000-5000");
    assert.equal(gapToBucket(8000), "5000-10000");
    assert.equal(gapToBucket(12000), "10000+");
  });

  it("records gap on second update", () => {
    const t0 = 1_000_000;
    recordEaQuoteTickGap(1, "EURUSDm", undefined, t0);
    recordEaQuoteTickGap(1, "EURUSDm", t0, t0 + 2500);

    const m = getEaQuoteTickMetrics(1, "EURUSDm");
    assert.ok(m && !Array.isArray(m));
    assert.equal(m.lastTickGapMs, 2500);
    assert.equal(m.histogram["1000-3000"], 1);
    assert.deepEqual(m.recentGapsMs, [2500]);
    assert.equal(m.totalUpdates, 2);
  });

  it("integrates with updateEaLiveQuotes", async () => {
    await updateEaLiveQuotes(42, [{ symbol: "EURUSDm", bid: 1.1, ask: 1.1002 }]);
    await updateEaLiveQuotes(42, [{ symbol: "EURUSDm", bid: 1.1001, ask: 1.1003 }]);

    const m = getEaQuoteTickMetrics(42, "EURUSDm");
    assert.ok(m && !Array.isArray(m));
    assert.equal(m.totalUpdates, 2);
  });
});
