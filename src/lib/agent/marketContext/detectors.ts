/**
 * Pure candle detectors shared by the specialist agents. No I/O, no LLM — these
 * run on warehouse candles so the agents reason on a real multi-candle context
 * (not 80–120 candles), and every level/zone is anchored to actual candle
 * time/price for faithful chart drawing.
 */

export interface AgentCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export type MarketRegime = "uptrend" | "downtrend" | "range" | "unknown";
export type Bias = "bullish" | "bearish" | "neutral" | "unknown";
export type TrendLabel = "uptrend" | "downtrend" | "range" | "unknown";

export interface Swing {
  type: "high" | "low";
  time: number;
  price: number;
}

export interface PriceLevel {
  price: number;
  time: number;
}

export interface SupplyDemandZone {
  type: "supply" | "demand";
  low: number;
  high: number;
  time: number;
}

/** Average True Range over the last 14 bars (null if too few candles). */
export function calculateAtr(candles: AgentCandle[]): number | null {
  if (candles.length < 15) return null;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i]!;
    const prev = candles[i - 1]!;
    trs.push(
      Math.max(
        c.high - c.low,
        Math.abs(c.high - prev.close),
        Math.abs(c.low - prev.close),
      ),
    );
  }
  const last14 = trs.slice(-14);
  return last14.reduce((a, b) => a + b, 0) / last14.length;
}

/**
 * Fractal swing points (2 bars each side). Returns the most recent ~80.
 * Left-strict / right-inclusive: an equal high (or low) plateau still
 * registers, on the FIRST bar of the equal run.
 */
export function detectSwings(candles: AgentCandle[]): Swing[] {
  const swings: Swing[] = [];
  for (let i = 2; i < candles.length - 2; i++) {
    const c = candles[i]!;
    const isHigh =
      c.high > candles[i - 1]!.high &&
      c.high > candles[i - 2]!.high &&
      c.high >= candles[i + 1]!.high &&
      c.high >= candles[i + 2]!.high;
    const isLow =
      c.low < candles[i - 1]!.low &&
      c.low < candles[i - 2]!.low &&
      c.low <= candles[i + 1]!.low &&
      c.low <= candles[i + 2]!.low;
    if (isHigh) swings.push({ type: "high", time: c.time, price: c.high });
    if (isLow) swings.push({ type: "low", time: c.time, price: c.low });
  }
  return swings.slice(-80);
}

/** Trend from the last few swing highs/lows (HH+HL / LH+LL). */
export function detectTrend(swings: Swing[]): TrendLabel {
  const highs = swings.filter((s) => s.type === "high").slice(-3);
  const lows = swings.filter((s) => s.type === "low").slice(-3);
  if (highs.length < 2 || lows.length < 2) return "unknown";
  const higherHighs = highs.at(-1)!.price > highs[0]!.price;
  const higherLows = lows.at(-1)!.price > lows[0]!.price;
  const lowerHighs = highs.at(-1)!.price < highs[0]!.price;
  const lowerLows = lows.at(-1)!.price < lows[0]!.price;
  if (higherHighs && higherLows) return "uptrend";
  if (lowerHighs && lowerLows) return "downtrend";
  return "range";
}

/** Major support/resistance from swing clusters + daily extremes. */
export function detectMajorLevels(
  candles: AgentCandle[],
  daily: AgentCandle[],
): { support: PriceLevel[]; resistance: PriceLevel[] } {
  const swings = detectSwings(candles);
  const last = candles.at(-1)?.close ?? 0;
  const support: PriceLevel[] = [];
  const resistance: PriceLevel[] = [];
  for (const s of swings) {
    if (s.type === "low" && s.price <= last) support.push({ price: s.price, time: s.time });
    if (s.type === "high" && s.price >= last) resistance.push({ price: s.price, time: s.time });
  }
  // Daily extremes as strong levels.
  if (daily.length) {
    const dHigh = Math.max(...daily.map((c) => c.high));
    const dLow = Math.min(...daily.map((c) => c.low));
    const dHighTime = daily.find((c) => c.high === dHigh)?.time ?? last;
    const dLowTime = daily.find((c) => c.low === dLow)?.time ?? last;
    if (dHigh >= last) resistance.push({ price: dHigh, time: dHighTime });
    if (dLow <= last) support.push({ price: dLow, time: dLowTime });
  }
  const nearest = (arr: PriceLevel[], desc: boolean) =>
    arr
      .sort((a, b) => Math.abs(last - a.price) - Math.abs(last - b.price))
      .slice(0, 5)
      .sort((a, b) => (desc ? b.price - a.price : a.price - b.price));
  return { support: nearest(support, true), resistance: nearest(resistance, false) };
}

/** Equal highs / equal lows (resting liquidity pools). */
export function detectLiquidity(candles: AgentCandle[]): {
  equalHighs: PriceLevel[];
  equalLows: PriceLevel[];
  nearestBuySide: PriceLevel | null;
  nearestSellSide: PriceLevel | null;
} {
  const last = candles.at(-1)?.close ?? 1;
  const tolerance = last * 0.0005;
  const equalHighs: PriceLevel[] = [];
  const equalLows: PriceLevel[] = [];
  for (let i = 1; i < candles.length; i++) {
    const a = candles[i - 1]!;
    const b = candles[i]!;
    if (Math.abs(a.high - b.high) <= tolerance) {
      equalHighs.push({ price: (a.high + b.high) / 2, time: b.time });
    }
    if (Math.abs(a.low - b.low) <= tolerance) {
      equalLows.push({ price: (a.low + b.low) / 2, time: b.time });
    }
  }
  return {
    equalHighs: equalHighs.slice(-20),
    equalLows: equalLows.slice(-20),
    // Buy-side liquidity rests above (equal highs); sell-side below (equal lows).
    nearestBuySide: equalHighs.filter((l) => l.price > last).at(0) ?? equalHighs.at(-1) ?? null,
    nearestSellSide: equalLows.filter((l) => l.price < last).at(-1) ?? equalLows.at(-1) ?? null,
  };
}

/** Demand/supply zones from impulse candles (order-block style). */
export function detectSupplyDemandZones(candles: AgentCandle[]): SupplyDemandZone[] {
  const zones: SupplyDemandZone[] = [];
  for (let i = 3; i < candles.length - 1; i++) {
    const c = candles[i]!;
    const next = candles[i + 1]!;
    const bullishImpulse = next.close > next.open && next.close > c.high;
    const bearishImpulse = next.close < next.open && next.close < c.low;
    if (bullishImpulse) {
      zones.push({
        type: "demand",
        low: Math.min(c.open, c.close, c.low),
        high: Math.max(c.open, c.close),
        time: c.time,
      });
    }
    if (bearishImpulse) {
      zones.push({
        type: "supply",
        low: Math.min(c.open, c.close),
        high: Math.max(c.open, c.close, c.high),
        time: c.time,
      });
    }
  }
  return zones.slice(-30);
}

/** Regime from net move vs range over the last 50 bars. */
export function detectMarketRegime(candles: AgentCandle[]): MarketRegime {
  if (candles.length < 50) return "unknown";
  const recent = candles.slice(-50);
  const high = Math.max(...recent.map((c) => c.high));
  const low = Math.min(...recent.map((c) => c.low));
  const range = high - low;
  if (range === 0) return "unknown";
  const net = recent.at(-1)!.close - recent[0]!.close;
  if (Math.abs(net) / range < 0.25) return "range";
  return net > 0 ? "uptrend" : "downtrend";
}

/** Directional bias from % change over the last 50 bars. */
export function biasFromCandles(candles: AgentCandle[]): Bias {
  if (!candles || candles.length < 50) return "unknown";
  const recent = candles.slice(-50);
  const first = recent[0]!.close;
  const last = recent.at(-1)!.close;
  if (first <= 0) return "unknown";
  const change = (last - first) / first;
  if (change > 0.003) return "bullish";
  if (change < -0.003) return "bearish";
  return "neutral";
}
