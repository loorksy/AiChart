import type { OhlcCandle } from "@/lib/ohlc/fetchOhlc";
import type { ChartDrawing } from "@/lib/chartDrawings";
import { fibDrawing } from "./drawings";
import { extractPivots, type Pivot } from "./pivots";

export interface FibLevel {
  ratio: number;
  price: number;
}

export interface FibAnalysis {
  direction: "up" | "down" | null;
  swingHigh: number | null;
  swingLow: number | null;
  levels: FibLevel[];
  /** The retracement level nearest to the current price (likely reaction zone). */
  nearestLevel: FibLevel | null;
  drawings: ChartDrawing[];
}

const RETRACE = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
const EXTEND = [1.272, 1.618];

function emptyFib(): FibAnalysis {
  return {
    direction: null,
    swingHigh: null,
    swingLow: null,
    levels: [],
    nearestLevel: null,
    drawings: [],
  };
}

/** Fibonacci over the most recent decisive swing (last alternating pivot pair). */
export function analyzeFib(candles: OhlcCandle[]): FibAnalysis {
  const pivots = extractPivots(candles);
  if (pivots.length < 2) return emptyFib();

  const b = pivots[pivots.length - 1]!;
  const a = pivots[pivots.length - 2]!;
  let high: Pivot;
  let low: Pivot;
  let direction: "up" | "down";
  if (a.kind === "low" && b.kind === "high") {
    low = a;
    high = b;
    direction = "up";
  } else if (a.kind === "high" && b.kind === "low") {
    high = a;
    low = b;
    direction = "down";
  } else {
    return emptyFib();
  }

  const range = high.price - low.price;
  if (range <= 0) return emptyFib();

  // For an up-swing, 0 sits at the high and 1 at the low (retraces downward).
  const levels: FibLevel[] = [];
  for (const r of RETRACE) {
    const price = direction === "up" ? high.price - range * r : low.price + range * r;
    levels.push({ ratio: r, price });
  }
  for (const r of EXTEND) {
    const price = direction === "up" ? high.price - range * r : low.price + range * r;
    levels.push({ ratio: r, price });
  }

  const close = candles[candles.length - 1]!.close;
  const nearestLevel =
    levels
      .filter((l) => l.ratio > 0 && l.ratio < 1)
      .sort((x, y) => Math.abs(x.price - close) - Math.abs(y.price - close))[0] ?? null;

  const drawings = [
    fibDrawing(
      high.price,
      low.price,
      high.index,
      low.index,
      candles.length,
      65,
      levels,
    ),
  ];

  return {
    direction,
    swingHigh: high.price,
    swingLow: low.price,
    levels,
    nearestLevel,
    drawings,
  };
}
