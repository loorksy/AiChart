import type { OhlcCandle } from "./fetchOhlc";

export interface DetectedLevel {
  price: number;
  type: "support" | "resistance";
  touches: number;
  lastIndex: number;
  /** Average swing-candle volume relative to the series median (1 = typical). */
  volumeScore: number | null;
  /** Deterministic 0-100 score from touches, relative volume, and recency. */
  strengthScore: number;
}

export interface StructureAnalysis {
  symbol: string;
  interval: string;
  currentPrice: number;
  supports: DetectedLevel[];
  resistances: DetectedLevel[];
  nearestSupport: number | null;
  nearestResistance: number | null;
  swingHighs: number[];
  swingLows: number[];
  structure: "uptrend" | "downtrend" | "range" | "unknown";
  summary: string;
}

const SWING_LOOKBACK = 2;
const LEVEL_TOLERANCE_PCT = 0.0008;
const MAX_LEVELS = 8;

interface MutableLevelCluster extends DetectedLevel {
  volumeWeightSum: number;
  volumeSamples: number;
}

function round(value: number, digits = 4): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function medianPositiveVolume(candles: OhlcCandle[]): number | null {
  const values = candles
    .map((candle) => candle.volume)
    .filter(
      (volume): volume is number =>
        volume != null && Number.isFinite(volume) && volume > 0,
    )
    .sort((a, b) => a - b);
  if (!values.length) return null;
  const middle = Math.floor(values.length / 2);
  return values.length % 2
    ? values[middle]!
    : (values[middle - 1]! + values[middle]!) / 2;
}

function isSwingHigh(candles: OhlcCandle[], index: number, lookback: number): boolean {
  const high = candles[index]!.high;
  for (let i = index - lookback; i <= index + lookback; i++) {
    if (i === index || i < 0 || i >= candles.length) continue;
    if (candles[i]!.high >= high) return false;
  }
  return true;
}

function isSwingLow(candles: OhlcCandle[], index: number, lookback: number): boolean {
  const low = candles[index]!.low;
  for (let i = index - lookback; i <= index + lookback; i++) {
    if (i === index || i < 0 || i >= candles.length) continue;
    if (candles[i]!.low <= low) return false;
  }
  return true;
}

function clusterLevels(
  prices: number[],
  type: "support" | "resistance",
  indices: number[],
  currentPrice: number,
  candles: OhlcCandle[],
): DetectedLevel[] {
  const baselineVolume = medianPositiveVolume(candles);
  const sorted = prices
    .map((price, i) => {
      const index = indices[i]!;
      const volume = candles[index]?.volume;
      const volumeWeight =
        baselineVolume != null &&
        volume != null &&
        Number.isFinite(volume) &&
        volume > 0
          ? volume / baselineVolume
          : null;
      return { price, index, volumeWeight };
    })
    .sort((a, b) => a.price - b.price);

  const clusters: MutableLevelCluster[] = [];

  for (const point of sorted) {
    const tol = Math.max(point.price * LEVEL_TOLERANCE_PCT, 1e-8);
    const existing = clusters.find(
      (c) => Math.abs(c.price - point.price) <= tol,
    );
    if (existing) {
      existing.touches += 1;
      existing.price = (existing.price + point.price) / 2;
      existing.lastIndex = Math.max(existing.lastIndex, point.index);
      if (point.volumeWeight != null) {
        existing.volumeWeightSum += point.volumeWeight;
        existing.volumeSamples += 1;
      }
    } else {
      clusters.push({
        price: point.price,
        type,
        touches: 1,
        lastIndex: point.index,
        volumeScore:
          point.volumeWeight == null ? null : round(point.volumeWeight),
        strengthScore: 0,
        volumeWeightSum: point.volumeWeight ?? 0,
        volumeSamples: point.volumeWeight == null ? 0 : 1,
      });
    }
  }

  const maxTouches = Math.max(1, ...clusters.map((cluster) => cluster.touches));
  const scored: DetectedLevel[] = clusters.map((cluster) => {
    const volumeScore =
      cluster.volumeSamples > 0
        ? cluster.volumeWeightSum / cluster.volumeSamples
        : null;
    const touchComponent = clamp01(cluster.touches / maxTouches);
    const recencyComponent =
      candles.length > 1 ? clamp01(cluster.lastIndex / (candles.length - 1)) : 0;
    const strengthScore =
      volumeScore == null
        ? 100 * touchComponent
        : 100 *
          (0.55 * touchComponent +
            0.3 * clamp01(volumeScore / 2) +
            0.15 * recencyComponent);
    return {
      price: cluster.price,
      type: cluster.type,
      touches: cluster.touches,
      lastIndex: cluster.lastIndex,
      volumeScore: volumeScore == null ? null : round(volumeScore),
      strengthScore: round(strengthScore, 2),
    };
  });

  return scored
    .sort((a, b) => {
      const distA = Math.abs(a.price - currentPrice);
      const distB = Math.abs(b.price - currentPrice);
      if (
        baselineVolume != null &&
        b.strengthScore !== a.strengthScore
      ) {
        return b.strengthScore - a.strengthScore;
      }
      if (b.touches !== a.touches) return b.touches - a.touches;
      return distA - distB;
    })
    .slice(0, MAX_LEVELS);
}

function inferStructure(
  swingHighs: number[],
  swingLows: number[],
): StructureAnalysis["structure"] {
  if (swingHighs.length < 2 || swingLows.length < 2) return "unknown";

  const recentHighs = swingHighs.slice(-3);
  const recentLows = swingLows.slice(-3);

  const hh = recentHighs.every(
    (h, i) => i === 0 || h >= recentHighs[i - 1]! * 0.999,
  );
  const hl = recentLows.every(
    (l, i) => i === 0 || l >= recentLows[i - 1]! * 0.999,
  );
  if (hh && hl) return "uptrend";

  const lh = recentHighs.every(
    (h, i) => i === 0 || h <= recentHighs[i - 1]! * 1.001,
  );
  const ll = recentLows.every(
    (l, i) => i === 0 || l <= recentLows[i - 1]! * 1.001,
  );
  if (lh && ll) return "downtrend";

  const highRange =
    Math.max(...recentHighs) - Math.min(...recentHighs);
  const lowRange = Math.max(...recentLows) - Math.min(...recentLows);
  const avg = (recentHighs[recentHighs.length - 1]! + recentLows[recentLows.length - 1]!) / 2;
  if (avg > 0 && (highRange + lowRange) / avg < 0.01) return "range";

  return "unknown";
}

/** Detects swing-based support/resistance and nearest levels. */
export function detectStructureLevels(
  symbol: string,
  interval: string,
  candles: OhlcCandle[],
): StructureAnalysis {
  if (candles.length < SWING_LOOKBACK * 2 + 3) {
    return {
      symbol,
      interval,
      currentPrice: candles[candles.length - 1]?.close ?? 0,
      supports: [],
      resistances: [],
      nearestSupport: null,
      nearestResistance: null,
      swingHighs: [],
      swingLows: [],
      structure: "unknown",
      summary: "لا تتوفر شموع كافية لاكتشاف مستويات.",
    };
  }

  const swingHighs: number[] = [];
  const swingHighIdx: number[] = [];
  const swingLows: number[] = [];
  const swingLowIdx: number[] = [];

  for (let i = SWING_LOOKBACK; i < candles.length - SWING_LOOKBACK; i++) {
    if (isSwingHigh(candles, i, SWING_LOOKBACK)) {
      swingHighs.push(candles[i]!.high);
      swingHighIdx.push(i);
    }
    if (isSwingLow(candles, i, SWING_LOOKBACK)) {
      swingLows.push(candles[i]!.low);
      swingLowIdx.push(i);
    }
  }

  const currentPrice = candles[candles.length - 1]!.close;
  const resistances = clusterLevels(
    swingHighs,
    "resistance",
    swingHighIdx,
    currentPrice,
    candles,
  );
  const supports = clusterLevels(
    swingLows,
    "support",
    swingLowIdx,
    currentPrice,
    candles,
  );

  const nearestSupport =
    supports.filter((s) => s.price <= currentPrice).sort((a, b) => b.price - a.price)[0]
      ?.price ?? null;
  const nearestResistance =
    resistances.filter((r) => r.price >= currentPrice).sort((a, b) => a.price - b.price)[0]
      ?.price ?? null;

  const structure = inferStructure(swingHighs, swingLows);
  const structureAr =
    structure === "uptrend"
      ? "اتجاه صاعد"
      : structure === "downtrend"
        ? "اتجاه هابط"
        : structure === "range"
          ? "نطاق عرضي"
          : "غير محدد";

  const parts = [structureAr];
  if (nearestSupport != null) {
    parts.push(`أقرب دعم ${nearestSupport.toFixed(5)}`);
  }
  if (nearestResistance != null) {
    parts.push(`أقرب مقاومة ${nearestResistance.toFixed(5)}`);
  }

  return {
    symbol,
    interval,
    currentPrice,
    supports,
    resistances,
    nearestSupport,
    nearestResistance,
    swingHighs: swingHighs.slice(-6),
    swingLows: swingLows.slice(-6),
    structure,
    summary: parts.join(" · "),
  };
}
