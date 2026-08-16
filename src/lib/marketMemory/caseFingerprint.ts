/**
 * Market-state fingerprints (docs/UNIFIED_AGENT_PLAN.md §10).
 *
 * "When has this happened before, and what came next" had no answer. The
 * platform's memory held trade lessons and conversation summaries — what the
 * operator did — but nothing about what the MARKET did, so a setup could not be
 * compared to its own history.
 *
 * A fingerprint describes one moment in structural terms: regime, trend, where
 * price sits in its range, how deep the last pullback ran, how strong the last
 * impulse was, volatility, and session. Similarity between two moments is
 * similarity of those features — not of the picture, which would match on
 * cosmetics and miss the setup.
 *
 * THE CRITICAL CONSTRAINT: a fingerprint is computed from candles at or before
 * its own timestamp. Nothing after it may touch a feature, or the memory
 * becomes a machine for predicting the past.
 */

export interface FingerprintCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export type Regime = "trend" | "range" | "volatile";
export type Trend = "up" | "down" | "flat";
export type RangeZone = "near_low" | "discount" | "mid" | "premium" | "near_high";
import { sessionOf, type TradingSession } from "@/lib/markets/tradingSession";

/** Re-exported under the name the case schema already uses. */
export type Session = TradingSession;

export interface CaseFingerprint {
  regime: Regime;
  trend: Trend;
  rangeZone: RangeZone;
  /** Retracement of the last impulse, 0–1. */
  pullbackDepth: number;
  /** Size of the last impulse in ATR. */
  impulseAtr: number;
  /** Current ATR as a fraction of price — comparable across instruments. */
  volatility: number;
  session: Session;
  /** Consecutive higher highs / lower lows leading in. */
  structureRun: number;
}

/** Feature vector for nearest-neighbour search; order is part of the contract. */
export function fingerprintVector(fingerprint: CaseFingerprint): number[] {
  const regime = { trend: 1, range: 0, volatile: 0.5 }[fingerprint.regime];
  const trend = { up: 1, down: -1, flat: 0 }[fingerprint.trend];
  const zone = {
    near_low: 0,
    discount: 0.25,
    mid: 0.5,
    premium: 0.75,
    near_high: 1,
  }[fingerprint.rangeZone];
  const session = { asia: 0, london: 0.5, newyork: 1 }[fingerprint.session];
  return [
    regime,
    trend,
    zone,
    Math.max(0, Math.min(1, fingerprint.pullbackDepth)),
    Math.max(0, Math.min(1, fingerprint.impulseAtr / 5)),
    Math.max(0, Math.min(1, fingerprint.volatility * 200)),
    session,
    Math.max(0, Math.min(1, fingerprint.structureRun / 6)),
  ];
}

/**
 * Similarity between two fingerprints, 0–1.
 *
 * Weighted rather than plain Euclidean: two moments differing only in session
 * are far more alike than two differing in trend, and treating every feature as
 * equally important would bury that.
 */
const WEIGHTS = [1.0, 1.4, 1.0, 0.8, 0.8, 0.7, 0.4, 0.6];

export function fingerprintSimilarity(a: CaseFingerprint, b: CaseFingerprint): number {
  const va = fingerprintVector(a);
  const vb = fingerprintVector(b);
  let weighted = 0;
  let total = 0;
  for (let i = 0; i < va.length; i++) {
    const w = WEIGHTS[i] ?? 1;
    weighted += w * Math.abs(va[i]! - vb[i]!);
    total += w;
  }
  return Math.max(0, 1 - weighted / total);
}

function atrOf(candles: readonly FingerprintCandle[], period = 14): number {
  const window = candles.slice(-period - 1);
  if (window.length < 2) return 0;
  let sum = 0;
  for (let i = 1; i < window.length; i++) {
    const prev = window[i - 1]!;
    const current = window[i]!;
    sum += Math.max(
      current.high - current.low,
      Math.abs(current.high - prev.close),
      Math.abs(current.low - prev.close),
    );
  }
  return sum / (window.length - 1);
}

/**
 * Fingerprint the moment ending at the LAST candle of `candles`.
 *
 * Callers must pass a window that ends where the case sits. Passing later
 * candles is the lookahead this whole design exists to prevent.
 */
export function fingerprintAt(candles: readonly FingerprintCandle[]): CaseFingerprint | null {
  if (candles.length < 30) return null;
  const last = candles.at(-1)!;
  const atr = atrOf(candles);
  if (!(atr > 0) || !(last.close > 0)) return null;

  const window = candles.slice(-60);
  const highs = window.map((candle) => candle.high);
  const lows = window.map((candle) => candle.low);
  const rangeHigh = Math.max(...highs);
  const rangeLow = Math.min(...lows);
  const span = Math.max(rangeHigh - rangeLow, Number.EPSILON);
  const position = (last.close - rangeLow) / span;

  const rangeZone: RangeZone =
    position >= 0.95
      ? "near_high"
      : position >= 0.62
        ? "premium"
        : position <= 0.05
          ? "near_low"
          : position <= 0.38
            ? "discount"
            : "mid";

  // Trend from the net move over the window, scaled by ATR so it means the same
  // thing on every instrument.
  const netMove = last.close - window[0]!.close;
  const trend: Trend = netMove > atr * 1.5 ? "up" : netMove < -atr * 1.5 ? "down" : "flat";

  // Regime: a wide range relative to ATR is trending or volatile; a tight one
  // is a range. Volatility separates the first two.
  const rangeAtr = span / atr;
  const recentAtr = atrOf(candles.slice(-15), 14);
  const volatilityRatio = atr > 0 ? recentAtr / atr : 1;
  const regime: Regime =
    volatilityRatio > 1.5 ? "volatile" : rangeAtr > 6 && trend !== "flat" ? "trend" : "range";

  // Last impulse and how far it has been retraced.
  const extremeIndex =
    trend === "down"
      ? lows.indexOf(rangeLow)
      : highs.indexOf(rangeHigh);
  const impulseStart = window[Math.max(0, extremeIndex - 10)]!.close;
  const impulseEnd = trend === "down" ? rangeLow : rangeHigh;
  const impulse = Math.abs(impulseEnd - impulseStart);
  const retraced = Math.abs(last.close - impulseEnd);
  const pullbackDepth = impulse > 0 ? Math.min(1, retraced / impulse) : 0;

  // How many consecutive bars extended the structure into this moment.
  let structureRun = 0;
  for (let i = window.length - 1; i > 0; i--) {
    const current = window[i]!;
    const prev = window[i - 1]!;
    const extends_ =
      trend === "down" ? current.low < prev.low : current.high > prev.high;
    if (!extends_) break;
    structureRun += 1;
  }

  return {
    regime,
    trend,
    rangeZone,
    pullbackDepth: Number(pullbackDepth.toFixed(3)),
    impulseAtr: Number((impulse / atr).toFixed(2)),
    volatility: Number((atr / last.close).toFixed(5)),
    session: sessionOf(last.time),
    structureRun,
  };
}
