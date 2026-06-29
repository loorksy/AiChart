import type { OhlcCandle } from "@/lib/ohlc/fetchOhlc";
import { detectStructureLevels } from "@/lib/ohlc/structure";
import type { ChartDrawing } from "@/lib/chartDrawings";
import { priceLineDrawing, zoneDrawing } from "./drawings";
import { extractPivots, near, type Pivot } from "./pivots";

export interface SupplyDemandZone {
  kind: "supply" | "demand";
  top: number;
  bottom: number;
  fromIndex: number;
  strength: number; // 0..1 — magnitude of the move that left the zone
}

export interface LiquidityPool {
  kind: "equal_highs" | "equal_lows";
  price: number;
  touches: number;
}

export interface BreakLevel {
  kind: "BOS" | "CHOCH";
  direction: "bullish" | "bearish";
  price: number;
}

export interface LevelsAnalysis {
  supports: number[];
  resistances: number[];
  nearestSupport: number | null;
  nearestResistance: number | null;
  zones: SupplyDemandZone[];
  liquidity: LiquidityPool[];
  breaks: BreakLevel[];
  drawings: ChartDrawing[];
}

/** Supply/demand zones: a pivot followed by an impulsive move away from it. */
function detectZones(candles: OhlcCandle[], pivots: Pivot[]): SupplyDemandZone[] {
  const out: SupplyDemandZone[] = [];
  const atr = avgRange(candles);
  if (atr <= 0) return out;

  for (const p of pivots) {
    const after = candles.slice(p.index + 1, p.index + 6);
    if (after.length < 2) continue;
    const candle = candles[p.index]!;
    if (p.kind === "high") {
      const drop = candle.high - Math.min(...after.map((c) => c.low));
      if (drop > atr * 1.5) {
        out.push({
          kind: "supply",
          top: candle.high,
          bottom: Math.min(candle.open, candle.close),
          fromIndex: p.index,
          strength: clamp01(drop / (atr * 4)),
        });
      }
    } else {
      const rise = Math.max(...after.map((c) => c.high)) - candle.low;
      if (rise > atr * 1.5) {
        out.push({
          kind: "demand",
          top: Math.max(candle.open, candle.close),
          bottom: candle.low,
          fromIndex: p.index,
          strength: clamp01(rise / (atr * 4)),
        });
      }
    }
  }
  // Keep the most recent few of each kind.
  return out.slice(-6);
}

/** Equal highs / equal lows = resting liquidity. */
function detectLiquidity(pivots: Pivot[]): LiquidityPool[] {
  const pools: LiquidityPool[] = [];
  for (const kind of ["high", "low"] as const) {
    const xs = pivots.filter((p) => p.kind === kind);
    const used = new Set<number>();
    for (let i = 0; i < xs.length; i++) {
      if (used.has(i)) continue;
      let sum = xs[i]!.price;
      let touches = 1;
      for (let j = i + 1; j < xs.length; j++) {
        if (used.has(j)) continue;
        if (near(xs[j]!.price, xs[i]!.price, 0.0012)) {
          used.add(j);
          sum += xs[j]!.price;
          touches++;
        }
      }
      if (touches >= 2) {
        pools.push({
          kind: kind === "high" ? "equal_highs" : "equal_lows",
          price: sum / touches,
          touches,
        });
      }
    }
  }
  return pools;
}

/** Break of structure / change of character relative to the latest pivots. */
function detectBreaks(candles: OhlcCandle[], pivots: Pivot[]): BreakLevel[] {
  const out: BreakLevel[] = [];
  const close = candles[candles.length - 1]?.close;
  if (close == null) return out;
  const highs = pivots.filter((p) => p.kind === "high");
  const lows = pivots.filter((p) => p.kind === "low");
  const lastHigh = highs[highs.length - 1];
  const prevHigh = highs[highs.length - 2];
  const lastLow = lows[lows.length - 1];
  const prevLow = lows[lows.length - 2];

  if (lastHigh && close > lastHigh.price) {
    const uptrend = prevHigh ? lastHigh.price > prevHigh.price : true;
    out.push({
      kind: uptrend ? "BOS" : "CHOCH",
      direction: "bullish",
      price: lastHigh.price,
    });
  }
  if (lastLow && close < lastLow.price) {
    const downtrend = prevLow ? lastLow.price < prevLow.price : true;
    out.push({
      kind: downtrend ? "BOS" : "CHOCH",
      direction: "bearish",
      price: lastLow.price,
    });
  }
  return out;
}

export function analyzeLevels(
  symbol: string,
  interval: string,
  candles: OhlcCandle[],
): LevelsAnalysis {
  const structure = detectStructureLevels(symbol, interval, candles);
  const pivots = extractPivots(candles);
  const zones = detectZones(candles, pivots);
  const liquidity = detectLiquidity(pivots);
  const breaks = detectBreaks(candles, pivots);

  const drawings: ChartDrawing[] = [];
  if (structure.nearestSupport != null) {
    drawings.push(
      priceLineDrawing(structure.nearestSupport, 70, "دعم", "#22c55e"),
    );
  }
  if (structure.nearestResistance != null) {
    drawings.push(
      priceLineDrawing(structure.nearestResistance, 70, "مقاومة", "#ef4444"),
    );
  }
  for (const z of zones) {
    drawings.push(
      zoneDrawing(
        z.top,
        z.bottom,
        z.fromIndex,
        candles.length,
        55 + Math.round(z.strength * 35),
        z.kind === "supply" ? "منطقة عرض" : "منطقة طلب",
        z.kind === "supply" ? "#ef4444" : "#22c55e",
      ),
    );
  }
  for (const pool of liquidity) {
    drawings.push(
      priceLineDrawing(
        pool.price,
        60,
        pool.kind === "equal_highs" ? "سيولة فوق" : "سيولة تحت",
        "#a78bfa",
      ),
    );
  }

  return {
    supports: structure.supports.map((s) => s.price),
    resistances: structure.resistances.map((r) => r.price),
    nearestSupport: structure.nearestSupport,
    nearestResistance: structure.nearestResistance,
    zones,
    liquidity,
    breaks,
    drawings,
  };
}

function avgRange(candles: OhlcCandle[]): number {
  if (candles.length === 0) return 0;
  const ranges = candles.slice(-30).map((c) => c.high - c.low);
  return ranges.reduce((a, b) => a + b, 0) / ranges.length;
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}
