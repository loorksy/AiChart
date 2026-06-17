import type { OhlcCandle } from "./fetchOhlc";

export interface DetectedLevel {
  price: number;
  type: "support" | "resistance";
  touches: number;
  lastIndex: number;
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
): DetectedLevel[] {
  const sorted = prices
    .map((price, i) => ({ price, index: indices[i]! }))
    .sort((a, b) => a.price - b.price);

  const clusters: DetectedLevel[] = [];

  for (const point of sorted) {
    const tol = Math.max(point.price * LEVEL_TOLERANCE_PCT, 1e-8);
    const existing = clusters.find(
      (c) => Math.abs(c.price - point.price) <= tol,
    );
    if (existing) {
      existing.touches += 1;
      existing.price = (existing.price + point.price) / 2;
      existing.lastIndex = Math.max(existing.lastIndex, point.index);
    } else {
      clusters.push({
        price: point.price,
        type,
        touches: 1,
        lastIndex: point.index,
      });
    }
  }

  return clusters
    .sort((a, b) => {
      const distA = Math.abs(a.price - currentPrice);
      const distB = Math.abs(b.price - currentPrice);
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
  );
  const supports = clusterLevels(
    swingLows,
    "support",
    swingLowIdx,
    currentPrice,
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
