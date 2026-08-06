import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  calibrateTradability,
  type CalibrationRow,
} from "@/lib/recommendations/tradabilityCalibration";

const HOUR = 3_600_000;

function row(over: Partial<CalibrationRow>): CalibrationRow {
  return {
    id: 1,
    timeframe: "1h",
    status: "active",
    createdAt: 1_000_000_000_000,
    contextJson: JSON.stringify({
      tradability: { tradability: "soon", expectedBarsToActivation: 3 },
    }),
    triggeredAt: null,
    ...over,
  };
}

describe("tradability calibration", () => {
  it("measures activation rate and realized bars per verdict", () => {
    const t0 = 1_000_000_000_000;
    const report = calibrateTradability([
      // `soon`, predicted 3 bars, activated after 2 candles.
      row({ id: 1, createdAt: t0, triggeredAt: t0 + 2 * HOUR }),
      // `soon`, never activated, expired — died waiting.
      row({ id: 2, status: "expired" }),
      // `now`, activated immediately.
      row({
        id: 3,
        contextJson: JSON.stringify({
          tradability: { tradability: "now", expectedBarsToActivation: 0 },
        }),
        createdAt: t0,
        triggeredAt: t0,
      }),
    ]);

    assert.equal(report.sampled, 3);
    assert.equal(report.ungraded, 0);

    const soon = report.verdicts.find((v) => v.verdict === "soon")!;
    assert.equal(soon.total, 2);
    assert.equal(soon.activated, 1);
    assert.equal(soon.diedWaiting, 1);
    assert.equal(soon.activationRate, 0.5);
    assert.equal(soon.avgPredictedBars, 3);
    assert.equal(soon.avgActualBars, 2);

    const now = report.verdicts.find((v) => v.verdict === "now")!;
    assert.equal(now.activationRate, 1);
    assert.equal(now.avgActualBars, 0);
  });

  it("counts pre-budget rows as ungraded instead of guessing", () => {
    const report = calibrateTradability([
      row({ contextJson: JSON.stringify({ statistical_support: "weak" }) }),
      row({ contextJson: null }),
      row({ contextJson: "{not json" }),
    ]);
    assert.equal(report.sampled, 3);
    assert.equal(report.ungraded, 3);
    assert.ok(report.verdicts.every((v) => v.total === 0));
  });

  it("a still-waiting plan is neither activated nor dead", () => {
    const report = calibrateTradability([row({ status: "active" })]);
    const soon = report.verdicts.find((v) => v.verdict === "soon")!;
    assert.equal(soon.total, 1);
    assert.equal(soon.activated, 0);
    assert.equal(soon.diedWaiting, 0);
  });
});
