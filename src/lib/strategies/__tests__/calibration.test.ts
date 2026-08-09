import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { calibrateBootstrapWinRate, wilsonScoreInterval } from "../calibration";

describe("calibrateBootstrapWinRate", () => {
  it("marks tiny samples as insufficient with a wide interval", () => {
    const tiny = calibrateBootstrapWinRate({
      wins: 1,
      samples: 1,
      iterations: 500,
      seed: 42,
      minTradesForCalibration: 30,
    });
    assert.equal(tiny.statisticallySufficient, false);
    assert.equal(tiny.method, "wilson");
    assert.ok(tiny.confidenceHigh - tiny.confidenceLow > 0.5, `expected wide band, got ${tiny.confidenceLow}-${tiny.confidenceHigh}`);
  });

  it("narrows the interval as the sample grows (same win rate)", () => {
    const small = calibrateBootstrapWinRate({
      wins: 6,
      samples: 10,
      iterations: 800,
      seed: 7,
      minTradesForCalibration: 5,
    });
    const large = calibrateBootstrapWinRate({
      wins: 60,
      samples: 100,
      iterations: 800,
      seed: 7,
      minTradesForCalibration: 5,
    });
    const smallWidth = small.confidenceHigh - small.confidenceLow;
    const largeWidth = large.confidenceHigh - large.confidenceLow;
    assert.ok(largeWidth < smallWidth, `expected narrower CI with more trades: ${largeWidth} vs ${smallWidth}`);
    assert.equal(large.statisticallySufficient, true);
  });

  it("is deterministic for the same seed and inputs", () => {
    const a = calibrateBootstrapWinRate({ wins: 40, samples: 80, iterations: 400, seed: 99, minTradesForCalibration: 10 });
    const b = calibrateBootstrapWinRate({ wins: 40, samples: 80, iterations: 400, seed: 99, minTradesForCalibration: 10 });
    assert.deepEqual(a, b);
  });

  it("wilson widens for n=1 vs n=100 at same rate", () => {
    const one = wilsonScoreInterval(1, 1);
    const many = wilsonScoreInterval(60, 100);
    assert.ok(one.high - one.low > many.high - many.low);
  });
});
