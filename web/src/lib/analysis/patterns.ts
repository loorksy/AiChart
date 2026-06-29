import type { OhlcCandle } from "@/lib/ohlc/fetchOhlc";
import type { ChartDrawing } from "@/lib/chartDrawings";
import { priceLineDrawing, segmentFromPivots } from "./drawings";
import { extractPivots, lastHighs, lastLows, near, type Pivot } from "./pivots";

export type PatternType =
  | "double_top"
  | "double_bottom"
  | "head_and_shoulders"
  | "inverse_head_and_shoulders"
  | "ascending_triangle"
  | "descending_triangle"
  | "symmetrical_triangle"
  | "rising_wedge"
  | "falling_wedge";

export interface PatternResult {
  type: PatternType;
  bias: "bullish" | "bearish";
  pivots: Pivot[];
  /** Neckline / breakout level that confirms the pattern. */
  breakLevel: number;
  /** Measured-move target once the break level gives way. */
  target: number;
  confidence: number;
  drawings: ChartDrawing[];
}

const PATTERN_LABEL: Record<PatternType, string> = {
  double_top: "قمة مزدوجة",
  double_bottom: "قاع مزدوج",
  head_and_shoulders: "رأس وكتفين",
  inverse_head_and_shoulders: "رأس وكتفين معكوس",
  ascending_triangle: "مثلث صاعد",
  descending_triangle: "مثلث هابط",
  symmetrical_triangle: "مثلث متماثل",
  rising_wedge: "وتد صاعد",
  falling_wedge: "وتد هابط",
};

export function patternLabel(type: PatternType): string {
  return PATTERN_LABEL[type];
}

function slope(a: Pivot, b: Pivot): number {
  return (b.price - a.price) / (b.index - a.index || 1);
}

function detectDoubleTop(candles: OhlcCandle[], pivots: Pivot[]): PatternResult | null {
  const highs = lastHighs(pivots, 2);
  if (highs.length < 2) return null;
  const [h1, h2] = highs as [Pivot, Pivot];
  if (!near(h1.price, h2.price, 0.004)) return null;
  const between = pivots.filter(
    (p) => p.kind === "low" && p.index > h1.index && p.index < h2.index,
  );
  const trough = between.sort((a, b) => a.price - b.price)[0];
  if (!trough) return null;
  const neckline = trough.price;
  const height = (h1.price + h2.price) / 2 - neckline;
  if (height <= 0) return null;
  const equality = 1 - Math.abs(h1.price - h2.price) / ((h1.price + h2.price) / 2);
  const confidence = Math.round(55 + equality * 40);
  return {
    type: "double_top",
    bias: "bearish",
    pivots: [h1, trough, h2],
    breakLevel: neckline,
    target: neckline - height,
    confidence,
    drawings: [
      segmentFromPivots(h1, h2, candles.length, confidence, "قمتان"),
      priceLineDrawing(neckline, confidence, "خط العنق", "#ef4444"),
    ],
  };
}

function detectDoubleBottom(candles: OhlcCandle[], pivots: Pivot[]): PatternResult | null {
  const lows = lastLows(pivots, 2);
  if (lows.length < 2) return null;
  const [l1, l2] = lows as [Pivot, Pivot];
  if (!near(l1.price, l2.price, 0.004)) return null;
  const between = pivots.filter(
    (p) => p.kind === "high" && p.index > l1.index && p.index < l2.index,
  );
  const peak = between.sort((a, b) => b.price - a.price)[0];
  if (!peak) return null;
  const neckline = peak.price;
  const height = neckline - (l1.price + l2.price) / 2;
  if (height <= 0) return null;
  const equality = 1 - Math.abs(l1.price - l2.price) / ((l1.price + l2.price) / 2);
  const confidence = Math.round(55 + equality * 40);
  return {
    type: "double_bottom",
    bias: "bullish",
    pivots: [l1, peak, l2],
    breakLevel: neckline,
    target: neckline + height,
    confidence,
    drawings: [
      segmentFromPivots(l1, l2, candles.length, confidence, "قاعان"),
      priceLineDrawing(neckline, confidence, "خط العنق", "#22c55e"),
    ],
  };
}

function detectHeadAndShoulders(
  candles: OhlcCandle[],
  pivots: Pivot[],
): PatternResult | null {
  const highs = lastHighs(pivots, 3);
  if (highs.length < 3) return null;
  const [ls, head, rs] = highs as [Pivot, Pivot, Pivot];
  if (!(head.price > ls.price && head.price > rs.price)) return null;
  if (!near(ls.price, rs.price, 0.01)) return null;
  const troughs = pivots.filter(
    (p) => p.kind === "low" && p.index > ls.index && p.index < rs.index,
  );
  if (troughs.length < 1) return null;
  const neckline = troughs.reduce((a, b) => a + b.price, 0) / troughs.length;
  const height = head.price - neckline;
  if (height <= 0) return null;
  const confidence = Math.round(
    60 + (1 - Math.abs(ls.price - rs.price) / ((ls.price + rs.price) / 2)) * 30,
  );
  return {
    type: "head_and_shoulders",
    bias: "bearish",
    pivots: [ls, head, rs],
    breakLevel: neckline,
    target: neckline - height,
    confidence,
    drawings: [priceLineDrawing(neckline, confidence, "خط العنق", "#ef4444")],
  };
}

function detectInverseHeadAndShoulders(
  candles: OhlcCandle[],
  pivots: Pivot[],
): PatternResult | null {
  const lows = lastLows(pivots, 3);
  if (lows.length < 3) return null;
  const [ls, head, rs] = lows as [Pivot, Pivot, Pivot];
  if (!(head.price < ls.price && head.price < rs.price)) return null;
  if (!near(ls.price, rs.price, 0.01)) return null;
  const peaks = pivots.filter(
    (p) => p.kind === "high" && p.index > ls.index && p.index < rs.index,
  );
  if (peaks.length < 1) return null;
  const neckline = peaks.reduce((a, b) => a + b.price, 0) / peaks.length;
  const height = neckline - head.price;
  if (height <= 0) return null;
  const confidence = Math.round(
    60 + (1 - Math.abs(ls.price - rs.price) / ((ls.price + rs.price) / 2)) * 30,
  );
  return {
    type: "inverse_head_and_shoulders",
    bias: "bullish",
    pivots: [ls, head, rs],
    breakLevel: neckline,
    target: neckline + height,
    confidence,
    drawings: [priceLineDrawing(neckline, confidence, "خط العنق", "#22c55e")],
  };
}

function detectTriangleOrWedge(
  candles: OhlcCandle[],
  pivots: Pivot[],
): PatternResult | null {
  const highs = lastHighs(pivots, 3);
  const lows = lastLows(pivots, 3);
  if (highs.length < 2 || lows.length < 2) return null;

  const hSlope = slope(highs[0]!, highs[highs.length - 1]!);
  const lSlope = slope(lows[0]!, lows[lows.length - 1]!);
  const flatTol = (candles[candles.length - 1]!.close || 1) * 1e-4;
  const close = candles[candles.length - 1]!.close;

  const highsEqual = near(highs[0]!.price, highs[highs.length - 1]!.price, 0.004);
  const lowsEqual = near(lows[0]!.price, lows[lows.length - 1]!.price, 0.004);
  const resLevel = highs[highs.length - 1]!.price;
  const supLevel = lows[lows.length - 1]!.price;
  const height = resLevel - supLevel;
  if (height <= 0) return null;

  // Ascending triangle — flat highs, rising lows.
  if (highsEqual && lSlope > flatTol) {
    return triangle("ascending_triangle", "bullish", highs, lows, resLevel, resLevel + height, 70, candles);
  }
  // Descending triangle — flat lows, falling highs.
  if (lowsEqual && hSlope < -flatTol) {
    return triangle("descending_triangle", "bearish", highs, lows, supLevel, supLevel - height, 70, candles);
  }
  // Wedges — both slopes same sign and converging.
  const converging = Math.abs(hSlope - lSlope) > flatTol;
  if (hSlope < -flatTol && lSlope < -flatTol && converging && hSlope > lSlope) {
    // Falling wedge (bullish): both down, support falls faster.
    return triangle("falling_wedge", "bullish", highs, lows, resLevel, resLevel + height, 64, candles);
  }
  if (hSlope > flatTol && lSlope > flatTol && converging && lSlope > hSlope) {
    // Rising wedge (bearish): both up, resistance rises slower.
    return triangle("rising_wedge", "bearish", highs, lows, supLevel, supLevel - height, 64, candles);
  }
  // Symmetrical triangle — falling highs, rising lows.
  if (hSlope < -flatTol && lSlope > flatTol) {
    const bias = close >= (resLevel + supLevel) / 2 ? "bullish" : "bearish";
    const breakLevel = bias === "bullish" ? resLevel : supLevel;
    const target = bias === "bullish" ? resLevel + height : supLevel - height;
    return triangle("symmetrical_triangle", bias, highs, lows, breakLevel, target, 60, candles);
  }
  return null;
}

function triangle(
  type: PatternType,
  bias: "bullish" | "bearish",
  highs: Pivot[],
  lows: Pivot[],
  breakLevel: number,
  target: number,
  confidence: number,
  candles: OhlcCandle[],
): PatternResult {
  return {
    type,
    bias,
    pivots: [...highs, ...lows].sort((a, b) => a.index - b.index),
    breakLevel,
    target,
    confidence,
    drawings: [
      segmentFromPivots(highs[0]!, highs[highs.length - 1]!, candles.length, confidence, "حدّ علوي"),
      segmentFromPivots(lows[0]!, lows[lows.length - 1]!, candles.length, confidence, "حدّ سفلي"),
      priceLineDrawing(breakLevel, confidence, "مستوى الكسر", bias === "bullish" ? "#22c55e" : "#ef4444"),
    ],
  };
}

/** Runs all geometric detectors and returns them ranked by confidence. */
export function detectPatterns(candles: OhlcCandle[]): PatternResult[] {
  const pivots = extractPivots(candles);
  if (pivots.length < 3) return [];
  const results: (PatternResult | null)[] = [
    detectDoubleTop(candles, pivots),
    detectDoubleBottom(candles, pivots),
    detectHeadAndShoulders(candles, pivots),
    detectInverseHeadAndShoulders(candles, pivots),
    detectTriangleOrWedge(candles, pivots),
  ];
  return results
    .filter((r): r is PatternResult => r !== null)
    .sort((a, b) => b.confidence - a.confidence);
}
