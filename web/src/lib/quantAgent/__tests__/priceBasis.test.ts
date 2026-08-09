import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  MAX_BASIS_DIVERGENCE_RATIO,
  isAnchored,
  resolvePriceBasis,
  shiftBars,
} from "@/lib/quantAgent/analysis/priceBasis";
import type { QuantOhlcBar } from "@/lib/quantAgent/types";

/**
 * The claim price-basis anchoring makes is arithmetic, not stylistic: shifting
 * the input series moves every LEVEL by the offset and leaves every DISTANCE
 * exactly where it was. If that stops being true the feature is not "slightly
 * off" — it is silently rewriting risk, because a stop distance IS the risk.
 * So these tests check the property, not the plumbing.
 */

function bar(time: number, o: number, h: number, l: number, c: number): QuantOhlcBar {
  return { time, open: o, high: h, low: l, close: c, volume: 100 };
}

const SERIES: QuantOhlcBar[] = [
  bar(1, 100, 110, 95, 105),
  bar(2, 105, 120, 100, 118),
  bar(3, 118, 125, 112, 115),
];

describe("shiftBars moves levels and preserves distances", () => {
  const delta = 0.37;
  const shifted = shiftBars(SERIES, delta);

  it("moves every price by exactly the offset", () => {
    for (const [i, original] of SERIES.entries()) {
      const moved = shifted[i]!;
      for (const field of ["open", "high", "low", "close"] as const) {
        assert.ok(
          Math.abs(moved[field] - (original[field] + delta)) < 1e-12,
          `${field} on bar ${i} did not move by delta`,
        );
      }
    }
  });

  it("leaves every intra-bar distance identical", () => {
    // This is the property that matters for money: a stop is a distance, and a
    // transform that changed it would change the risk of every trade.
    for (const [i, original] of SERIES.entries()) {
      const moved = shifted[i]!;
      assert.equal(moved.high - moved.low, original.high - original.low, `range on bar ${i}`);
      assert.equal(moved.close - moved.open, original.close - original.open, `body on bar ${i}`);
    }
  });

  it("leaves bar-to-bar returns and true range identical", () => {
    for (let i = 1; i < SERIES.length; i += 1) {
      assert.equal(
        shifted[i]!.close - shifted[i - 1]!.close,
        SERIES[i]!.close - SERIES[i - 1]!.close,
        `close-to-close change at ${i}`,
      );
    }
  });

  it("does not touch volume, which is not a price", () => {
    assert.deepEqual(
      shifted.map((b) => b.volume),
      SERIES.map((b) => b.volume),
    );
  });

  it("returns the same array when there is nothing to move", () => {
    assert.equal(shiftBars(SERIES, 0), SERIES);
    assert.equal(shiftBars(SERIES, Number.NaN), SERIES);
  });

  it("does not mutate the caller's bars", () => {
    const before = JSON.stringify(SERIES);
    shiftBars(SERIES, 5);
    assert.equal(JSON.stringify(SERIES), before, "the reference series must stay comparable");
  });
});

describe("resolvePriceBasis", () => {
  const quote = (bid: number, ask: number) => async () => ({ bid, ask, observedAt: 0 });

  it("reports unlinked when there is no user, without calling the broker", async () => {
    let called = false;
    const b = await resolvePriceBasis({
      userId: null,
      symbol: "XAUUSD",
      referencePrice: 2400,
      getQuote: async () => {
        called = true;
        return null;
      },
    });
    assert.equal(b.status, "unlinked");
    assert.equal(b.delta, 0);
    assert.equal(b.suppressLevels, false, "an unlinked reader still gets levels");
    assert.equal(called, false, "no account means no reason to ask");
  });

  it("reports unavailable when there is no reference price to measure against", async () => {
    const b = await resolvePriceBasis({ userId: 1, symbol: "XAUUSD", referencePrice: null });
    assert.equal(b.status, "unavailable");
    assert.equal(b.suppressLevels, false);
  });

  it("degrades to unlinked when the broker does not answer", async () => {
    const b = await resolvePriceBasis({
      userId: 1,
      symbol: "XAUUSD",
      referencePrice: 2400,
      getQuote: async () => null,
    });
    assert.equal(b.status, "unlinked");
    assert.equal(b.suppressLevels, false, "a slow broker must not withhold the analysis");
  });

  it("anchors to the mid of the reader's spread, not to one side", async () => {
    // Anchoring to the bid would bake half the reader's spread into every level.
    const b = await resolvePriceBasis({
      userId: 1,
      symbol: "XAUUSD",
      referencePrice: 2400,
      getQuote: quote(2400.2, 2400.6),
    });
    assert.equal(b.status, "anchored");
    assert.ok(Math.abs(b.delta - 0.4) < 1e-9, `expected mid-based delta 0.4, got ${b.delta}`);
    // Tolerance, not equality: (2400.2 + 2400.6) / 2 is 2400.3999999999996 in
    // binary floating point, and asserting the decimal literal would be
    // testing IEEE-754 rather than the midpoint.
    assert.ok(Math.abs((b.brokerMid ?? 0) - 2400.4) < 1e-9, `mid was ${b.brokerMid}`);
    assert.ok(isAnchored(b));
  });

  it("withholds levels when the two books disagree beyond the threshold", async () => {
    // Just past the limit: a different instrument, or a series stale enough
    // that its levels describe a market that has moved on. Either way the
    // levels are wrong, and sliding them would only hide that.
    const reference = 2400;
    const beyond = reference * (1 + MAX_BASIS_DIVERGENCE_RATIO * 1.2);
    const b = await resolvePriceBasis({
      userId: 1,
      symbol: "XAUUSD",
      referencePrice: reference,
      getQuote: quote(beyond, beyond),
    });
    assert.equal(b.status, "divergent");
    assert.equal(b.suppressLevels, true);
    assert.equal(isAnchored(b), false, "a divergent basis must never shift anything");
  });

  it("still anchors just inside the threshold", async () => {
    const reference = 2400;
    const inside = reference * (1 + MAX_BASIS_DIVERGENCE_RATIO * 0.8);
    const b = await resolvePriceBasis({
      userId: 1,
      symbol: "XAUUSD",
      referencePrice: reference,
      getQuote: quote(inside, inside),
    });
    assert.equal(b.status, "anchored");
    assert.equal(b.suppressLevels, false);
  });

  it("treats a negligible offset as already aligned rather than shifting noise", async () => {
    const b = await resolvePriceBasis({
      userId: 1,
      symbol: "EURUSD",
      referencePrice: 1.08,
      getQuote: quote(1.08, 1.08),
    });
    assert.equal(b.status, "aligned");
    assert.equal(isAnchored(b), false);
  });

  it("never throws when the quote call itself fails", async () => {
    const b = await resolvePriceBasis({
      userId: 1,
      symbol: "XAUUSD",
      referencePrice: 2400,
      getQuote: async () => {
        throw new Error("rpc exploded");
      },
    });
    assert.equal(b.status, "unlinked");
    assert.equal(b.suppressLevels, false, "an analysis must survive a broken quote");
  });
});
