import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  deflatedSharpe,
  expectedMaxSharpeUnderNull,
  informationCoefficient,
  MIN_ABS_IC,
  normalCdf,
  normalQuantile,
  screenByInformationCoefficient,
  selectionGuardRequired,
  SELECTION_GUARD_REQUIRED_ABOVE,
} from "@/lib/strategies/selectionBias";

describe("information coefficient", () => {
  it("is +1 for a perfect positive relationship and -1 for the inverse", () => {
    const f = [1, 2, 3, 4, 5];
    assert.ok(Math.abs(informationCoefficient(f, [2, 4, 6, 8, 10])! - 1) < 1e-9);
    assert.ok(Math.abs(informationCoefficient(f, [10, 8, 6, 4, 2])! + 1) < 1e-9);
  });

  it("is null when a series has no variance or the sample is tiny", () => {
    assert.equal(informationCoefficient([1, 1, 1], [1, 2, 3]), null);
    assert.equal(informationCoefficient([1, 2], [1, 2]), null);
  });
});

describe("IC pre-filter decides SPEND, not truth", () => {
  const sized = (fn: (i: number) => number, n = 80) => Array.from({ length: n }, (_, i) => fn(i));

  it("refuses to judge below the minimum sample", () => {
    const v = screenByInformationCoefficient({
      factor: [1, 2, 3],
      forwardReturns: [1, 2, 3],
    });
    assert.equal(v.proceed, false);
    assert.match(v.reason, /insufficient_sample_for_ic/);
  });

  it("passes a promising candidate to the full backtest", () => {
    const v = screenByInformationCoefficient({
      factor: sized((i) => i),
      forwardReturns: sized((i) => i * 0.5 + (i % 3)),
    });
    assert.equal(v.proceed, true);
    assert.ok(Math.abs(v.ic!) >= MIN_ABS_IC);
  });

  it("skips a candidate with no relationship", () => {
    // Alternating factor against a monotone return: near-zero correlation.
    const v = screenByInformationCoefficient({
      factor: sized((i) => (i % 2 === 0 ? 1 : -1)),
      forwardReturns: sized((i) => i),
    });
    assert.equal(v.proceed, false);
    assert.match(v.reason, /ic_below_threshold|ic_undefined/);
  });
});

describe("normal helpers", () => {
  it("cdf and quantile are consistent", () => {
    assert.ok(Math.abs(normalCdf(0) - 0.5) < 1e-6);
    assert.ok(Math.abs(normalCdf(1.645) - 0.95) < 1e-3);
    assert.ok(Math.abs(normalQuantile(0.975) - 1.96) < 1e-2);
    for (const p of [0.05, 0.5, 0.9, 0.99]) {
      assert.ok(Math.abs(normalCdf(normalQuantile(p)) - p) < 1e-3, `roundtrip p=${p}`);
    }
  });
});

describe("selection-bias guard (item 18, step 3)", () => {
  it("the luck bar RISES with the number of trials", () => {
    const one = expectedMaxSharpeUnderNull(1);
    const hundred = expectedMaxSharpeUnderNull(100);
    const thousand = expectedMaxSharpeUnderNull(1000);
    assert.equal(one, 0, "a single test has no selection effect");
    assert.ok(hundred > one);
    assert.ok(thousand > hundred, "searching more must raise the bar, never lower it");
  });

  it("the SAME Sharpe can pass alone and fail after a wide search", () => {
    const common = { observedSharpe: 1.2, sampleSize: 500, confidence: 0.95 };
    const alone = deflatedSharpe({ ...common, trials: 1 });
    const searched = deflatedSharpe({ ...common, trials: 1000 });
    assert.equal(alone.passes, true, "a strong standalone result should pass");
    assert.equal(
      searched.passes,
      false,
      "the same number found by searching 1000 configs is not a discovery",
    );
    assert.ok(searched.probability < alone.probability);
  });

  it("a genuinely strong edge still passes a wide search", () => {
    const v = deflatedSharpe({
      observedSharpe: 3.5,
      sampleSize: 1000,
      trials: 500,
      confidence: 0.95,
    });
    assert.equal(v.passes, true, "the guard must not reject real edge");
  });

  it("more observations sharpen the verdict in BOTH directions", () => {
    // Above the luck bar: more data raises confidence that the edge is real.
    const strongMany = deflatedSharpe({ observedSharpe: 3.0, sampleSize: 1000, trials: 50 });
    const strongFew = deflatedSharpe({ observedSharpe: 3.0, sampleSize: 30, trials: 50 });
    assert.ok(
      strongFew.probability < strongMany.probability,
      "a thin sample must not claim as much certainty as a thick one",
    );

    // Below the luck bar the effect REVERSES, and that is correct: more data
    // makes you more certain the result is NOT a discovery. A thin sample is
    // merely uncertain — it must never be mistaken for evidence in favour.
    const weakMany = deflatedSharpe({ observedSharpe: 1.0, sampleSize: 1000, trials: 50 });
    const weakFew = deflatedSharpe({ observedSharpe: 1.0, sampleSize: 30, trials: 50 });
    assert.ok(weakMany.probability < weakFew.probability);
    assert.equal(weakMany.passes, false);
    assert.equal(weakFew.passes, false, "uncertainty is never a pass");
  });

  it("reports the luck bar it measured against", () => {
    const v = deflatedSharpe({ observedSharpe: 0.5, sampleSize: 200, trials: 200 });
    assert.ok(v.expectedMaxUnderNull > 0);
    assert.match(v.reason, /luck_bar/);
  });

  it("names the catalog size that makes the guard mandatory", () => {
    assert.equal(selectionGuardRequired(SELECTION_GUARD_REQUIRED_ABOVE), false);
    assert.equal(selectionGuardRequired(SELECTION_GUARD_REQUIRED_ABOVE + 1), true);
  });
});
