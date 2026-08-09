/**
 * Selection-bias guard and cheap IC pre-filter (RELIABILITY_PLAN.md item 18,
 * steps 2 and 3 — both MANDATORY before the catalog grows past ~100).
 *
 * The arithmetic that makes this non-negotiable: test 100 random strategies at
 * a 5% significance level and ~5 of them clear the bar on luck alone. Test
 * 1,000 and you get ~50 "discoveries", all noise. Without a multiple-testing
 * correction, a bigger catalog does not find more edge — it manufactures more
 * false confidence, and the gates that protect the operator become theatre.
 *
 * Two tools, in the plan's order:
 *
 * 1. **IC pre-filter** — a cheap Information Coefficient screen so only
 *    promising candidates pay for a full backtest. It NEVER promotes anything;
 *    it only decides what is worth testing properly.
 * 2. **Deflated Sharpe** — the acceptance threshold rises with the number of
 *    trials, so a strategy selected out of many must clear a HIGHER bar than
 *    one tested alone.
 *
 * Nothing here loosens a gate: these raise the bar, never lower it.
 */

/** Pearson correlation between a factor and forward returns (the IC). */
export function informationCoefficient(
  factor: readonly number[],
  forwardReturns: readonly number[],
): number | null {
  const n = Math.min(factor.length, forwardReturns.length);
  if (n < 3) return null;
  const x = factor.slice(0, n);
  const y = forwardReturns.slice(0, n);
  const mx = x.reduce((a, b) => a + b, 0) / n;
  const my = y.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    const a = x[i]! - mx;
    const b = y[i]! - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  if (dx === 0 || dy === 0) return null;
  return num / Math.sqrt(dx * dy);
}

/** Minimum |IC| worth spending a full backtest on. */
export const MIN_ABS_IC = 0.03;
/** Minimum observations before an IC means anything at all. */
export const MIN_IC_SAMPLE = 60;

export interface IcScreenVerdict {
  /** Should this candidate proceed to a full backtest? */
  proceed: boolean;
  ic: number | null;
  reason: string;
}

/**
 * Cheap screen before the expensive run. A candidate that fails is SKIPPED,
 * never rejected as a strategy — the screen decides spend, not truth.
 */
export function screenByInformationCoefficient(input: {
  factor: readonly number[];
  forwardReturns: readonly number[];
}): IcScreenVerdict {
  if (Math.min(input.factor.length, input.forwardReturns.length) < MIN_IC_SAMPLE) {
    return {
      proceed: false,
      ic: null,
      reason: `insufficient_sample_for_ic:${Math.min(input.factor.length, input.forwardReturns.length)}/${MIN_IC_SAMPLE}`,
    };
  }
  const ic = informationCoefficient(input.factor, input.forwardReturns);
  if (ic == null) {
    return { proceed: false, ic: null, reason: "ic_undefined_zero_variance" };
  }
  if (Math.abs(ic) < MIN_ABS_IC) {
    return { proceed: false, ic, reason: `ic_below_threshold:${ic.toFixed(4)}` };
  }
  return { proceed: true, ic, reason: `ic_promising:${ic.toFixed(4)}` };
}

// --- Deflated Sharpe / multiple-testing correction ---------------------------

/** Standard normal CDF (Abramowitz–Stegun 7.1.26 via erf approximation). */
export function normalCdf(z: number): number {
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t +
      0.254829592) *
      t *
      Math.exp(-x * x);
  return 0.5 * (1 + sign * y);
}

/** Inverse standard normal CDF (Acklam's rational approximation). */
export function normalQuantile(p: number): number {
  if (p <= 0 || p >= 1) return p <= 0 ? -Infinity : Infinity;
  const a = [-39.6968302866538, 220.946098424521, -275.928510446969, 138.357751867269, -30.6647980661472, 2.50662827745924];
  const b = [-54.4760987982241, 161.585836858041, -155.698979859887, 66.8013118877197, -13.2806815528857];
  const c = [-0.00778489400243029, -0.322396458041136, -2.40075827716184, -2.54973253934373, 4.37466414146497, 2.93816398269878];
  const d = [0.00778469570904146, 0.32246712907004, 2.445134137143, 3.75440866190742];
  const pLow = 0.02425;
  if (p < pLow) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
      ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  if (p > 1 - pLow) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
      ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  const q = p - 0.5;
  const r = q * q;
  return (((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q /
    (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1);
}

const EULER_MASCHERONI = 0.5772156649015329;

/**
 * Expected maximum of `trials` draws from a standard normal — the order
 * statistic at the heart of the deflation. It is DIMENSIONLESS: callers must
 * scale it by the standard deviation of the trial Sharpe estimates to get a
 * Sharpe-valued bar (see `deflatedSharpe`). Comparing a Sharpe against this
 * number directly would demand a per-bar Sharpe above ~3, which no real
 * strategy reaches, so the guard would reject everything.
 */
export function expectedMaxSharpeUnderNull(trials: number): number {
  const n = Math.max(1, Math.floor(trials));
  if (n === 1) return 0;
  // Bailey & López de Prado's expected-maximum order statistic approximation.
  return (
    (1 - EULER_MASCHERONI) * normalQuantile(1 - 1 / n) +
    EULER_MASCHERONI * normalQuantile(1 - 1 / (n * Math.E))
  );
}

export interface DeflatedSharpeVerdict {
  /** Probability the observed Sharpe beats what selection alone would produce. */
  probability: number;
  /** The luck bar for this many trials. */
  expectedMaxUnderNull: number;
  /** True only when the strategy clears the selection-adjusted bar. */
  passes: boolean;
  reason: string;
}

/**
 * Deflated Sharpe Ratio. `trials` is the number of configurations searched to
 * find this one — the catalog size, not 1. Testing more candidates RAISES the
 * bar, which is exactly the protection the plan requires before the catalog
 * grows.
 */
export function deflatedSharpe(input: {
  observedSharpe: number;
  /** Independent return observations behind the Sharpe. */
  sampleSize: number;
  /** How many configurations were searched. */
  trials: number;
  /** Skew/kurtosis of returns; defaults are the normal case. */
  skewness?: number;
  kurtosis?: number;
  /** Confidence required to accept. */
  confidence?: number;
}): DeflatedSharpeVerdict {
  const confidence = input.confidence ?? 0.95;
  const n = Math.max(2, Math.floor(input.sampleSize));
  const skew = input.skewness ?? 0;
  const kurt = input.kurtosis ?? 3;
  const sr = input.observedSharpe;

  // Standard error of the Sharpe estimate, adjusted for non-normal returns.
  const variance = (1 - skew * sr + ((kurt - 1) / 4) * sr * sr) / (n - 1);
  const se = Math.sqrt(Math.max(variance, 1e-12));

  // The luck bar is the order statistic SCALED INTO SHARPE UNITS by the spread
  // of the trial estimates (approximated by this estimate's standard error).
  // Skipping this scaling is the classic implementation error: it compares a
  // Sharpe to a z-score, which either rejects every real strategy or — with an
  // annualized Sharpe — accepts every fake one.
  const expectedMaxUnderNull = se * expectedMaxSharpeUnderNull(input.trials);
  const z = (sr - expectedMaxUnderNull) / se;
  const probability = normalCdf(z);
  const passes = probability >= confidence;

  return {
    probability,
    expectedMaxUnderNull,
    passes,
    reason: passes
      ? `deflated_sharpe_pass p=${probability.toFixed(4)} trials=${input.trials}`
      : `deflated_sharpe_fail p=${probability.toFixed(4)} needs>=${confidence} trials=${input.trials} luck_bar=${expectedMaxUnderNull.toFixed(3)}`,
  };
}

/**
 * The catalog size beyond which the plan REQUIRES the selection-bias guard to
 * be active. Kept here so the number lives with the maths that justifies it.
 */
export const SELECTION_GUARD_REQUIRED_ABOVE = 100;

/** Is the guard mandatory for a catalog of this size? */
export function selectionGuardRequired(catalogSize: number): boolean {
  return catalogSize > SELECTION_GUARD_REQUIRED_ABOVE;
}

export interface SelectionBiasVerdict {
  passes: boolean;
  reason: string;
  probability: number | null;
  expectedMaxUnderNull: number | null;
  trials: number;
}

/**
 * Bars per year per timeframe — MUST mirror `annual_periods` in
 * research-service/app/backtest/policies.py. The stored `sharpe_ratio` is
 * ANNUALIZED there (`mean/std * sqrt(annual_periods)`), while the deflated
 * Sharpe compares against a standard-normal order statistic and therefore
 * needs the PER-OBSERVATION Sharpe.
 *
 * Getting this wrong is not a rounding error: feeding an annualized 1m Sharpe
 * (scaled by ~612x) straight in would clear any luck bar, so the guard would
 * pass everything while looking like it was protecting the operator. A gate
 * that cannot reject is worse than no gate, because it manufactures trust.
 */
const TIMEFRAME_MINUTES: Record<string, number> = {
  "1m": 1,
  "5m": 5,
  "15m": 15,
  "30m": 30,
  "1h": 60,
  "4h": 240,
  "1d": 1440,
};

export function annualPeriodsForTimeframe(timeframe: string): number | null {
  const tf = timeframe.trim().toLowerCase();
  if (tf === "1d") return 260;
  const minutes = TIMEFRAME_MINUTES[tf];
  if (!minutes) return null;
  return Math.round((52 * 5 * 24 * 60) / minutes);
}

/** Convert the stored annualized Sharpe back to a per-observation Sharpe. */
export function deannualizeSharpe(
  annualizedSharpe: number,
  timeframe: string,
): number | null {
  const periods = annualPeriodsForTimeframe(timeframe);
  if (!periods || periods <= 0) return null;
  return annualizedSharpe / Math.sqrt(periods);
}

/**
 * Apply the guard to a completed backtest at the eligibility decision.
 *
 * Missing inputs are handled by SIZE, not by assumption:
 * - Below the mandatory catalog size the guard passes through (a small catalog
 *   barely searches, and blocking on a missing Sharpe would break the existing
 *   pipeline for no statistical gain).
 * - At or above it, a missing Sharpe FAILS: once selection pressure is real,
 *   "we could not measure it" must not read as "it passed".
 */
export function evaluateSelectionBias(input: {
  /** The STORED (annualized) Sharpe from the backtest metrics. */
  sharpeRatio: number | null | undefined;
  /** Timeframe the Sharpe was annualized on — required to undo that scaling. */
  timeframe: string;
  /** Equity observations the Sharpe was computed over (bars, not trades). */
  observationCount: number | null | undefined;
  trials: number;
}): SelectionBiasVerdict {
  const trials = Math.max(1, Math.floor(input.trials));
  const guardRequired = selectionGuardRequired(trials);
  const annualized =
    typeof input.sharpeRatio === "number" && Number.isFinite(input.sharpeRatio)
      ? input.sharpeRatio
      : null;
  const sample =
    typeof input.observationCount === "number" && input.observationCount > 1
      ? Math.floor(input.observationCount)
      : null;
  // The Sharpe and the null distribution must live on the SAME scale.
  const sharpe = annualized == null ? null : deannualizeSharpe(annualized, input.timeframe);

  if (sharpe == null || sample == null) {
    return {
      passes: !guardRequired,
      reason: guardRequired
        ? "selection_guard_required_but_inputs_unavailable"
        : "selection_guard_not_required_small_catalog",
      probability: null,
      expectedMaxUnderNull: null,
      trials,
    };
  }

  const verdict = deflatedSharpe({
    observedSharpe: sharpe,
    sampleSize: sample,
    trials,
  });
  // Below the mandatory size the result is RECORDED but not enforced, so the
  // number is visible before it starts rejecting anything.
  return {
    passes: guardRequired ? verdict.passes : true,
    reason: guardRequired
      ? verdict.reason
      : `${verdict.reason} (advisory: catalog <= ${SELECTION_GUARD_REQUIRED_ABOVE})`,
    probability: verdict.probability,
    expectedMaxUnderNull: verdict.expectedMaxUnderNull,
    trials,
  };
}
