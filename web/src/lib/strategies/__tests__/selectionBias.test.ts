import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  annualPeriodsForTimeframe,
  deannualizeSharpe,
  deflatedSharpe,
  evaluateSelectionBias,
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

  // NOTE: these are PER-OBSERVATION Sharpes (the scale the deflation works on).
  // Realistic per-bar values are small — 0.01–0.2 — not the annualized figures
  // shown in reports. Using annualized numbers here would make every case pass
  // and the tests meaningless.
  it("the SAME Sharpe can pass alone and fail after a wide search", () => {
    const common = { observedSharpe: 0.06, sampleSize: 1000, confidence: 0.95 };
    const alone = deflatedSharpe({ ...common, trials: 1 });
    const searched = deflatedSharpe({ ...common, trials: 1000 });
    assert.equal(alone.passes, true, "a solid standalone result should pass");
    assert.equal(
      searched.passes,
      false,
      "the same number found by searching 1000 configs is not a discovery",
    );
    assert.ok(searched.probability < alone.probability);
  });

  it("a genuinely strong edge still passes a wide search", () => {
    const v = deflatedSharpe({
      observedSharpe: 0.2,
      sampleSize: 1000,
      trials: 500,
      confidence: 0.95,
    });
    assert.equal(v.passes, true, "the guard must not reject real edge");
  });

  it("a thin sample cannot claim the certainty of a thick one", () => {
    const many = deflatedSharpe({ observedSharpe: 0.15, sampleSize: 1000, trials: 50 });
    const few = deflatedSharpe({ observedSharpe: 0.15, sampleSize: 30, trials: 50 });
    assert.ok(
      few.probability < many.probability,
      "the same Sharpe on 30 observations proves far less",
    );
    assert.equal(many.passes, true);
    assert.equal(few.passes, false, "uncertainty is never a pass");
  });

  it("reports the luck bar it measured against when it rejects", () => {
    const v = deflatedSharpe({ observedSharpe: 0.01, sampleSize: 200, trials: 200 });
    assert.equal(v.passes, false);
    assert.ok(v.expectedMaxUnderNull > 0, "the bar must be a real Sharpe-valued number");
    assert.match(v.reason, /luck_bar/);
  });

  it("the luck bar is expressed in SHARPE units, not z-units", () => {
    // Regression: comparing a Sharpe against the raw order statistic (~3) would
    // reject every real strategy, since per-bar Sharpes never approach 3.
    const v = deflatedSharpe({ observedSharpe: 0.1, sampleSize: 5000, trials: 500 });
    assert.ok(
      v.expectedMaxUnderNull < 1,
      `bar ${v.expectedMaxUnderNull} must be scaled by the estimate's standard error`,
    );
  });

  it("names the catalog size that makes the guard mandatory", () => {
    assert.equal(selectionGuardRequired(SELECTION_GUARD_REQUIRED_ABOVE), false);
    assert.equal(selectionGuardRequired(SELECTION_GUARD_REQUIRED_ABOVE + 1), true);
  });
});

describe("Sharpe scale must match the null distribution", () => {
  // The stored Sharpe is ANNUALIZED (mean/std * sqrt(annual_periods)) in
  // research-service/app/backtest/metrics.py. Comparing it directly against a
  // standard-normal order statistic would clear any luck bar, so the guard
  // would pass EVERYTHING while looking protective. That is worse than no
  // guard, because it manufactures trust.
  it("mirrors the Python annual_periods table exactly", () => {
    assert.equal(annualPeriodsForTimeframe("1d"), 260);
    assert.equal(annualPeriodsForTimeframe("1m"), Math.round((52 * 5 * 24 * 60) / 1));
    assert.equal(annualPeriodsForTimeframe("5m"), Math.round((52 * 5 * 24 * 60) / 5));
    assert.equal(annualPeriodsForTimeframe("1h"), Math.round((52 * 5 * 24 * 60) / 60));
    assert.equal(annualPeriodsForTimeframe("nonsense"), null);
  });

  it("de-annualizing inverts the scaling", () => {
    const perBar = 0.02;
    const periods = annualPeriodsForTimeframe("5m")!;
    const annualized = perBar * Math.sqrt(periods);
    assert.ok(Math.abs(deannualizeSharpe(annualized, "5m")! - perBar) < 1e-9);
  });

  it("REGRESSION: a raw annualized Sharpe must not sail through the guard", () => {
    // A mediocre per-bar edge (0.01) looks spectacular once annualized on 1m.
    const periods = annualPeriodsForTimeframe("1m")!;
    const annualized = 0.01 * Math.sqrt(periods); // ~6.1
    const guarded = evaluateSelectionBias({
      sharpeRatio: annualized,
      timeframe: "1m",
      observationCount: 40_000,
      trials: 500,
    });
    // Correctly de-annualized, 0.01 per bar is nowhere near the luck bar.
    assert.equal(guarded.passes, false, "the scale fix is what makes this gate real");

    // Proof the naive wiring WOULD have passed it.
    const naive = deflatedSharpe({ observedSharpe: annualized, sampleSize: 40_000, trials: 500 });
    assert.equal(naive.passes, true, "…exactly the false-confidence trap being prevented");
  });

  it("an unknown timeframe cannot be scaled, so it is not silently trusted", () => {
    const v = evaluateSelectionBias({
      sharpeRatio: 5,
      timeframe: "13m",
      observationCount: 10_000,
      trials: 500,
    });
    assert.equal(v.passes, false);
    assert.match(v.reason, /inputs_unavailable/);
  });
});

describe("guard wired to the eligibility decision", () => {
  // A genuinely strong per-bar edge, expressed as the stored annualized value.
  const strongAnnualized = 0.06 * Math.sqrt(annualPeriodsForTimeframe("5m")!);
  const weakAnnualized = 0.002 * Math.sqrt(annualPeriodsForTimeframe("5m")!);
  const base = { timeframe: "5m", observationCount: 20_000 };

  it("is ADVISORY for today's small catalog — it records without rejecting", () => {
    const v = evaluateSelectionBias({ ...base, sharpeRatio: weakAnnualized, trials: 75 });
    assert.equal(v.passes, true, "a small catalog barely searches; do not block");
    assert.match(v.reason, /advisory/);
    assert.ok(v.probability != null, "the number is still measured and stored");
  });

  it("becomes ENFORCING automatically once the catalog crosses the line", () => {
    const v = evaluateSelectionBias({
      ...base,
      sharpeRatio: weakAnnualized,
      trials: SELECTION_GUARD_REQUIRED_ABOVE + 1,
    });
    assert.equal(v.passes, false, "expansion must switch the guard on by itself");
    assert.doesNotMatch(v.reason, /advisory/);
  });

  it("still admits genuinely strong edge in a large catalog", () => {
    const v = evaluateSelectionBias({ ...base, sharpeRatio: strongAnnualized, trials: 500 });
    assert.equal(v.passes, true, "the guard must not reject real edge");
  });

  it("unmeasurable inputs FAIL once selection pressure is real", () => {
    const missing = evaluateSelectionBias({
      ...base,
      sharpeRatio: null,
      trials: 500,
    });
    assert.equal(missing.passes, false, "'could not measure' must not read as 'passed'");

    // …but it does not break the existing small-catalog pipeline.
    assert.equal(
      evaluateSelectionBias({ ...base, sharpeRatio: null, trials: 50 }).passes,
      true,
    );
  });

  it("reports the trial count it corrected for", () => {
    assert.equal(
      evaluateSelectionBias({ ...base, sharpeRatio: strongAnnualized, trials: 321 }).trials,
      321,
    );
  });
});
