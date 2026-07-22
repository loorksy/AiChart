import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeForexLots,
  resolveSizingReferencePrice,
} from "@/lib/brokers/lotSizing";
import type { EaSymbolSpec } from "@/lib/types";

const spec: EaSymbolSpec = {
  symbol: "EURUSD",
  tick_size: 0.0001,
  tick_value: 10,
  min_lot: 0.01,
  max_lot: 100,
  lot_step: 0.01,
};

describe("verified stop-distance lot sizing", () => {
  it("uses the executable broker quote before the analysed entry for market orders", () => {
    assert.equal(
      resolveSizingReferencePrice({
        orderType: "market",
        analysedEntry: 1.1,
        sideQuote: 1.1012,
        ask: 1.1012,
        bid: 1.101,
      }),
      1.1012,
    );
  });

  it("uses only the explicit limit for pending-order sizing", () => {
    assert.equal(
      resolveSizingReferencePrice({
        orderType: "limit",
        limitPrice: 1.095,
        analysedEntry: 1.1,
        sideQuote: 1.1012,
      }),
      1.095,
    );
    assert.equal(
      resolveSizingReferencePrice({
        orderType: "limit",
        limitPrice: null,
        analysedEntry: 1.1,
        sideQuote: 1.1012,
      }),
      0,
    );
  });

  it("reduces lots when the stop is wider", () => {
    const tight = computeForexLots(100, 1.1, 1.095, spec);
    const wide = computeForexLots(100, 1.1, 1.09, spec);
    assert.equal(tight.ok, true);
    assert.equal(wide.ok, true);
    assert.ok(tight.lots > wide.lots);
  });

  it("rounds down to broker lot step", () => {
    const result = computeForexLots(103, 1.1, 1.095, spec);
    assert.equal(result.ok, true);
    assert.equal(result.lots, 0.2);
    assert.ok((result.lossPerLot ?? 0) * result.lots <= 103);
  });

  it("fails instead of bumping to a minimum lot that exceeds risk", () => {
    const result = computeForexLots(1, 1.1, 1.09, spec);
    assert.equal(result.ok, false);
    assert.equal(result.lots, 0);
  });

  it("fails closed without stop or complete symbol economics", () => {
    assert.equal(computeForexLots(100, 1.1, null, spec).ok, false);
    assert.equal(computeForexLots(100, 1.1, 1.09, null).ok, false);
    assert.equal(computeForexLots(100, 1.1, 1.09, { ...spec, tick_value: 0 }).ok, false);
  });
});
