/**
 * Statistical confidence calibration for strategy evidence.
 *
 * For tiny samples, a pure IID bootstrap of the empirical trade list is
 * degenerate (n=1 always resamples to 0% or 100%). We therefore:
 * - mark samples below `minTradesForCalibration` as statistically insufficient
 * - report a Wilson score interval (honest binomial CI) for the band
 * - once the sample is large enough, switch to nonparametric bootstrap of
 *   the actual trade outcomes (seeded for deterministic re-runs)
 *
 * Inspired by the validation-discipline pattern in open MIT backtest engines
 * (walk-forward + resampling CI); implemented independently for AiChart.
 */

export type BootstrapWinRateCalibration = {
  method: "wilson" | "bootstrap_iid";
  samples: number;
  iterations: number;
  winRate: number;
  confidenceLow: number;
  confidenceHigh: number;
  statisticallySufficient: boolean;
  seed: number;
};

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function xorshift32(seed: number): () => number {
  let state = seed >>> 0;
  if (state === 0) state = 0x9e3779b9;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x100000000;
  };
}

/** Wilson score interval for a binomial proportion. */
export function wilsonScoreInterval(
  wins: number,
  samples: number,
  z = 1.6448536269514722, // ~90% two-sided
): { low: number; high: number } {
  if (samples <= 0) return { low: 0, high: 1 };
  const p = wins / samples;
  const z2 = z * z;
  const denom = 1 + z2 / samples;
  const center = p + z2 / (2 * samples);
  const margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * samples)) / samples);
  return {
    low: clamp01((center - margin) / denom),
    high: clamp01((center + margin) / denom),
  };
}

/**
 * Deterministic bootstrap CI over binary trade outcomes.
 * Falls back to Wilson when the sample is too small for a meaningful resample.
 */
export function calibrateBootstrapWinRate(input: {
  wins: number;
  samples: number;
  iterations?: number;
  confidenceLevel?: number;
  seed?: number;
  minTradesForCalibration?: number;
}): BootstrapWinRateCalibration {
  const wins = Math.max(0, Math.floor(input.wins));
  const samples = Math.max(0, Math.floor(input.samples));
  const iterations = Math.max(200, Math.floor(input.iterations ?? 2000));
  const confidenceLevel = Math.min(0.99, Math.max(0.5, input.confidenceLevel ?? 0.9));
  const seed = Math.floor(input.seed ?? 0xa1c4a7);
  const minTrades = Math.max(2, Math.floor(input.minTradesForCalibration ?? 30));
  const winRate = samples > 0 ? wins / samples : 0;
  const alpha = 1 - confidenceLevel;
  const z = confidenceLevel >= 0.95 ? 1.959963984540054 : 1.6448536269514722;

  if (samples <= 0) {
    return {
      method: "wilson",
      samples: 0,
      iterations: 0,
      winRate: 0,
      confidenceLow: 0,
      confidenceHigh: 1,
      statisticallySufficient: false,
      seed,
    };
  }

  if (samples < minTrades) {
    const band = wilsonScoreInterval(wins, samples, z);
    return {
      method: "wilson",
      samples,
      iterations: 0,
      winRate,
      confidenceLow: band.low,
      confidenceHigh: band.high,
      statisticallySufficient: false,
      seed,
    };
  }

  const outcomes = Array.from({ length: samples }, (_, index) => index < wins);
  const rng = xorshift32(seed);
  const rates: number[] = [];
  for (let iter = 0; iter < iterations; iter += 1) {
    let resampleWins = 0;
    for (let i = 0; i < samples; i += 1) {
      const pick = Math.floor(rng() * samples);
      if (outcomes[pick]) resampleWins += 1;
    }
    rates.push(resampleWins / samples);
  }
  rates.sort((a, b) => a - b);
  const lowIndex = Math.max(0, Math.min(rates.length - 1, Math.floor((alpha / 2) * rates.length)));
  const highIndex = Math.max(0, Math.min(rates.length - 1, Math.floor((1 - alpha / 2) * rates.length)));

  return {
    method: "bootstrap_iid",
    samples,
    iterations,
    winRate,
    confidenceLow: clamp01(rates[lowIndex] ?? 0),
    confidenceHigh: clamp01(rates[highIndex] ?? 1),
    statisticallySufficient: true,
    seed,
  };
}
