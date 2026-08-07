/**
 * Lightweight technical indicators computed in code (the cheap "monitoring
 * layer"). These run on every request without calling the LLM, so the
 * expensive decision layer (Claude) is only invoked with structured signals.
 */

export function sma(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const slice = values.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

/**
 * Average True Range — volatility measure for adaptive stops/sizing.
 * TR = max(high-low, |high-prevClose|, |low-prevClose|); ATR = mean(TR, period).
 */
export function atr(
  candles: { high: number; low: number; close: number }[],
  period = 14,
): number | null {
  if (candles.length < period + 1) return null;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i]!;
    const prevClose = candles[i - 1]!.close;
    trs.push(
      Math.max(
        c.high - c.low,
        Math.abs(c.high - prevClose),
        Math.abs(c.low - prevClose),
      ),
    );
  }
  const slice = trs.slice(-period);
  if (slice.length === 0) return null;
  return slice.reduce((a, b) => a + b, 0) / slice.length;
}

export function ema(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const k = 2 / (period + 1);
  // Seed with SMA of the first `period` values.
  let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
  }
  return prev;
}

/** Wilder's RSI. Returns a value in [0, 100] or null if not enough data. */
export function rsi(values: number[], period = 14): number | null {
  if (values.length < period + 1) return null;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) gain += diff;
    else loss -= diff;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  for (let i = period + 1; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    const g = diff > 0 ? diff : 0;
    const l = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export interface MacdResult {
  macd: number;
  signal: number;
  histogram: number;
}

export function macd(
  values: number[],
  fast = 12,
  slow = 26,
  signalPeriod = 9,
): MacdResult | null {
  if (values.length < slow + signalPeriod) return null;
  // Build a MACD-line series so we can EMA it for the signal line.
  const macdSeries: number[] = [];
  for (let i = slow; i <= values.length; i++) {
    const window = values.slice(0, i);
    const f = ema(window, fast);
    const s = ema(window, slow);
    if (f === null || s === null) continue;
    macdSeries.push(f - s);
  }
  const macdLine = macdSeries[macdSeries.length - 1];
  const signal = ema(macdSeries, signalPeriod);
  if (signal === null) return null;
  return { macd: macdLine, signal, histogram: macdLine - signal };
}

export interface BollingerResult {
  upper: number;
  middle: number;
  lower: number;
  /** Where the last close sits inside the band: 0 = lower, 1 = upper. */
  percentB: number;
  /** Band width relative to the middle — a squeeze/expansion measure. */
  widthPct: number;
}

/** Classic Bollinger Bands (SMA ± mult·σ, population σ like charting apps). */
export function bollinger(
  values: number[],
  period = 20,
  mult = 2,
): BollingerResult | null {
  if (values.length < period) return null;
  const window = values.slice(-period);
  const middle = window.reduce((a, b) => a + b, 0) / period;
  const variance =
    window.reduce((acc, v) => acc + (v - middle) ** 2, 0) / period;
  const sd = Math.sqrt(variance);
  const upper = middle + mult * sd;
  const lower = middle - mult * sd;
  const last = values[values.length - 1];
  const range = upper - lower;
  return {
    upper,
    middle,
    lower,
    percentB: range > 0 ? (last - lower) / range : 0.5,
    widthPct: middle !== 0 ? range / Math.abs(middle) : 0,
  };
}

export interface StochasticResult {
  /** %K (fast, smoothed over `smoothK`). */
  k: number;
  /** %D — SMA of %K over `periodD`. */
  d: number;
}

/** Stochastic oscillator %K/%D over highs/lows, both in [0, 100]. */
export function stochastic(
  candles: { high: number; low: number; close: number }[],
  periodK = 14,
  smoothK = 3,
  periodD = 3,
): StochasticResult | null {
  const need = periodK + smoothK + periodD - 2;
  if (candles.length < need) return null;
  const rawK: number[] = [];
  for (let i = periodK - 1; i < candles.length; i++) {
    const window = candles.slice(i - periodK + 1, i + 1);
    let highest = -Infinity;
    let lowest = Infinity;
    for (const c of window) {
      if (c.high > highest) highest = c.high;
      if (c.low < lowest) lowest = c.low;
    }
    const span = highest - lowest;
    rawK.push(span > 0 ? ((candles[i].close - lowest) / span) * 100 : 50);
  }
  const smoothed: number[] = [];
  for (let i = smoothK - 1; i < rawK.length; i++) {
    const win = rawK.slice(i - smoothK + 1, i + 1);
    smoothed.push(win.reduce((a, b) => a + b, 0) / smoothK);
  }
  if (smoothed.length < periodD) return null;
  const k = smoothed[smoothed.length - 1];
  const dWin = smoothed.slice(-periodD);
  return { k, d: dWin.reduce((a, b) => a + b, 0) / periodD };
}

/** Wilder's ADX — trend STRENGTH in [0, 100], direction-blind. */
export function adx(
  candles: { high: number; low: number; close: number }[],
  period = 14,
): number | null {
  // Wilder smoothing needs period bars to seed DI and period more to seed ADX.
  if (candles.length < 2 * period + 1) return null;
  const trs: number[] = [];
  const plusDMs: number[] = [];
  const minusDMs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const cur = candles[i];
    const prev = candles[i - 1];
    trs.push(
      Math.max(
        cur.high - cur.low,
        Math.abs(cur.high - prev.close),
        Math.abs(cur.low - prev.close),
      ),
    );
    const upMove = cur.high - prev.high;
    const downMove = prev.low - cur.low;
    plusDMs.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDMs.push(downMove > upMove && downMove > 0 ? downMove : 0);
  }
  const seed = (arr: number[]) => arr.slice(0, period).reduce((a, b) => a + b, 0);
  let smTr = seed(trs);
  let smPlus = seed(plusDMs);
  let smMinus = seed(minusDMs);
  const dxs: number[] = [];
  for (let i = period; i < trs.length; i++) {
    smTr = smTr - smTr / period + trs[i];
    smPlus = smPlus - smPlus / period + plusDMs[i];
    smMinus = smMinus - smMinus / period + minusDMs[i];
    if (smTr === 0) {
      dxs.push(0);
      continue;
    }
    const plusDI = (smPlus / smTr) * 100;
    const minusDI = (smMinus / smTr) * 100;
    const diSum = plusDI + minusDI;
    dxs.push(diSum > 0 ? (Math.abs(plusDI - minusDI) / diSum) * 100 : 0);
  }
  if (dxs.length < period) return null;
  let value = dxs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < dxs.length; i++) {
    value = (value * (period - 1) + dxs[i]) / period;
  }
  return value;
}
