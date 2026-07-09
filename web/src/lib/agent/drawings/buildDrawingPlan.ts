/**
 * Drawing plan layer. The agent NEVER draws straight off raw fractal detectors.
 * Instead the final decision + full market context produce an explicit plan that
 * says WHETHER to draw, WHAT intent, and exactly WHICH scored levels/zones —
 * only high-strength, validated ones. A WAIT with no strong context draws
 * nothing; a trade setup draws its POI + trade path; weak fractal noise is
 * dropped. The DrawingAgent renders this plan and nothing else.
 */
import type { AgentMarketContext } from "../marketContext/buildAgentMarketContext";
import type { AgentCandle, PriceLevel } from "../marketContext/detectors";
import type { FinalDecisionResult } from "../agents/finalDecisionAgent";
import type { StructureResult } from "../agents/structureAgent";
import type { SupplyDemandResult } from "../agents/supplyDemandAgent";
import type { LiquidityResult } from "../agents/liquidityAgent";
import type { MultiTimeframeResult } from "../agents/multiTimeframeAgent";

/** Minimum candle history required before ANY level/zone drawing is trusted. */
export const MIN_CANDLES_FOR_DRAWINGS = {
  currentTf: 500,
  higherTf: 200,
  daily: 100,
} as const;

/** Strength gate: a level/zone below this score is never drawn. */
export const DEFAULT_STRENGTH_THRESHOLD = 75;
export const MINIMAL_STRENGTH_THRESHOLD = 85;

export type DrawingPlan = {
  shouldDraw: boolean;
  reason: string;
  drawingIntent:
    | "trade_setup"
    | "wait_zones"
    | "scenario_paths"
    | "educational"
    | "none";
  selectedLevels: Array<{
    type: "support" | "resistance" | "liquidity";
    price: number;
    time: number;
    strength: number;
    reason: string;
  }>;
  selectedZones: Array<{
    type: "supply" | "demand" | "retest" | "range";
    low: number;
    high: number;
    time: number;
    strength: number;
    reason: string;
  }>;
  forecastPath?: Array<{ time: number; price: number }>;
};

export interface DrawingPlanInput {
  decision: FinalDecisionResult;
  market: AgentMarketContext;
  structure: StructureResult | null;
  supplyDemand: SupplyDemandResult | null;
  liquidity: LiquidityResult | null;
  mtf: MultiTimeframeResult | null;
  preferMinimalDrawings?: boolean;
}

/** True only when there is enough multi-timeframe history to draw reliably. */
export function hasSufficientDataForDrawings(market: AgentMarketContext): boolean {
  return (
    market.currentTfCandles.length >= MIN_CANDLES_FOR_DRAWINGS.currentTf &&
    market.higherTfCandles.length >= MIN_CANDLES_FOR_DRAWINGS.higherTf &&
    market.dailyCandles.length >= MIN_CANDLES_FOR_DRAWINGS.daily
  );
}

export function buildDrawingPlan(input: DrawingPlanInput): DrawingPlan {
  const threshold = input.preferMinimalDrawings
    ? MINIMAL_STRENGTH_THRESHOLD
    : DEFAULT_STRENGTH_THRESHOLD;
  const rec = input.decision.recommendation;

  // Hard data gate: never invent levels from a tiny candle window.
  if (!hasSufficientDataForDrawings(input.market)) {
    return {
      shouldDraw: false,
      reason:
        "البيانات التاريخية غير كافية لرسم مستويات موثوقة. تم طلب استكمال البيانات.",
      drawingIntent: "none",
      selectedLevels: [],
      selectedZones: [],
    };
  }

  // --- Valid trade setup → draw the POI + forecast path only. ---
  if (rec.action === "buy" || rec.action === "sell") {
    const zone =
      rec.action === "buy"
        ? input.supplyDemand?.nearestDemand
        : input.supplyDemand?.nearestSupply;

    if (
      !zone ||
      rec.entry == null ||
      rec.stop_loss == null ||
      !rec.targets?.length
    ) {
      return {
        shouldDraw: false,
        reason: "خطة الصفقة تفتقد منطقة POI صالحة أو مستويات دخول/وقف/هدف.",
        drawingIntent: "none",
        selectedLevels: [],
        selectedZones: [],
      };
    }

    return {
      shouldDraw: true,
      reason: "خطة صفقة صالحة: منطقة POI + دخول + وقف + أهداف.",
      drawingIntent: "trade_setup",
      selectedLevels: [],
      selectedZones: [
        {
          type: rec.action === "buy" ? "demand" : "supply",
          low: zone.low,
          high: zone.high,
          time: zone.time,
          strength: Math.max(scoreZone(zone, input), 70),
          reason: "منطقة POI المختارة للصفقة النهائية.",
        },
      ],
      forecastPath: buildForecastPathFromTrade(input.market, {
        entry: rec.entry,
        target: rec.targets[0]!,
      }),
    };
  }

  // --- WAIT → draw ONLY strong, validated zones/levels (or nothing). ---
  const levels = [
    ...(input.structure?.support ?? []).map((l) => ({
      ...l,
      role: "support" as const,
    })),
    ...(input.structure?.resistance ?? []).map((l) => ({
      ...l,
      role: "resistance" as const,
    })),
  ]
    .map((level) => ({
      type: level.role,
      price: level.price,
      time: level.time,
      strength: scoreLevel(level, input),
      reason: "مستوى مُقيَّم من البنية والسياق.",
    }))
    .filter((level) => level.strength >= threshold)
    .sort((a, b) => b.strength - a.strength)
    .slice(0, 3);

  const zones = (input.supplyDemand?.zones ?? [])
    .map((zone) => ({
      type: zone.type,
      low: zone.low,
      high: zone.high,
      time: zone.time,
      strength: scoreZone(zone, input),
      reason: "منطقة عرض/طلب مُقيَّمة.",
    }))
    .filter((zone) => zone.strength >= threshold)
    .sort((a, b) => b.strength - a.strength)
    .slice(0, 2);

  if (!levels.length && !zones.length) {
    return {
      shouldDraw: false,
      reason:
        "قرار انتظار دون مستويات أو مناطق قوية موثوقة — الرسم الآن سيكون مضللاً.",
      drawingIntent: "none",
      selectedLevels: [],
      selectedZones: [],
    };
  }

  return {
    shouldDraw: true,
    reason: "قرار انتظار مع مناطق/مستويات عالية القوة فقط.",
    drawingIntent: "wait_zones",
    selectedLevels: levels,
    selectedZones: zones,
  };
}

// --- Scoring ---------------------------------------------------------------

/**
 * Score a support/resistance level 0–100 from real confluence factors:
 * touches, reaction size, liquidity, higher-timeframe alignment, on-screen
 * relevance — and penalize levels crowded next to another level (noise).
 */
export function scoreLevel(
  level: PriceLevel,
  input: DrawingPlanInput,
): number {
  const candles = input.market.currentTfCandles;
  const atr = input.market.atr ?? approxAtr(candles) ?? level.price * 0.001;
  let score = 0;

  const touches = countTouches(level.price, candles, atr);
  if (touches >= 3) score += 25;
  else score += touches * 8;

  if (measureReactionAtr(level.price, candles, atr) >= 1.0) score += 20;
  if (isNearLiquidity(level.price, input.liquidity, atr)) score += 15;
  if (isHtfAligned(level.price, input.market, atr)) score += 20;
  if (isVisibleOnChart(level.price, input.market.visibleCandles)) score += 10;
  if (isTooCloseToOtherLevel(level.price, input.structure, atr)) score -= 20;

  return clamp(score);
}

/** Score a supply/demand zone 0–100: freshness, reaction, HTF confluence. */
export function scoreZone(
  zone: { low: number; high: number; time: number },
  input: DrawingPlanInput,
): number {
  const candles = input.market.currentTfCandles;
  const atr = input.market.atr ?? approxAtr(candles) ?? 0;
  const mid = (zone.low + zone.high) / 2;
  let score = 30; // an impulse-origin zone starts with a base weight

  const touches = countTouches(mid, candles, atr || mid * 0.001);
  score += Math.min(touches, 3) * 8;

  if (measureReactionAtr(mid, candles, atr || mid * 0.001) >= 1.0) score += 20;
  if (isHtfAligned(mid, input.market, atr || mid * 0.001)) score += 20;
  if (isVisibleOnChart(mid, input.market.visibleCandles)) score += 10;

  return clamp(score);
}

// --- Factor helpers --------------------------------------------------------

function countTouches(
  price: number,
  candles: AgentCandle[],
  atr: number,
): number {
  const tol = Math.max(atr * 0.35, price * 0.0004);
  let touches = 0;
  for (const c of candles) {
    if (c.low - tol <= price && price <= c.high + tol) touches++;
  }
  return touches;
}

/** Largest post-touch move away from the level, in ATR units. */
function measureReactionAtr(
  price: number,
  candles: AgentCandle[],
  atr: number,
): number {
  if (atr <= 0) return 0;
  const tol = Math.max(atr * 0.35, price * 0.0004);
  let best = 0;
  for (let i = 0; i < candles.length - 1; i++) {
    const c = candles[i]!;
    const touched = c.low - tol <= price && price <= c.high + tol;
    if (!touched) continue;
    const window = candles.slice(i + 1, i + 9);
    for (const w of window) {
      best = Math.max(best, Math.abs(w.high - price), Math.abs(w.low - price));
    }
  }
  return best / atr;
}

function isNearLiquidity(
  price: number,
  liquidity: LiquidityResult | null,
  atr: number,
): boolean {
  if (!liquidity) return false;
  const tol = Math.max(atr * 0.5, price * 0.0005);
  const pools = [...liquidity.equalHighs, ...liquidity.equalLows];
  return pools.some((p) => Math.abs(p.price - price) <= tol);
}

/** Aligned when a daily/major level sits within tolerance of this price. */
function isHtfAligned(
  price: number,
  market: AgentMarketContext,
  atr: number,
): boolean {
  const tol = Math.max(atr * 0.75, price * 0.0008);
  const majors = [
    ...market.majorLevels.support,
    ...market.majorLevels.resistance,
  ];
  if (majors.some((m) => Math.abs(m.price - price) <= tol)) return true;
  return market.dailyCandles.some(
    (c) => Math.abs(c.high - price) <= tol || Math.abs(c.low - price) <= tol,
  );
}

function isVisibleOnChart(price: number, visible: AgentCandle[]): boolean {
  if (!visible.length) return true; // no visible-range hint → don't penalize
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  for (const c of visible) {
    lo = Math.min(lo, c.low);
    hi = Math.max(hi, c.high);
  }
  return price >= lo && price <= hi;
}

function isTooCloseToOtherLevel(
  price: number,
  structure: StructureResult | null,
  atr: number,
): boolean {
  if (!structure) return false;
  const tol = Math.max(atr * 0.4, price * 0.0004);
  const others = [...structure.support, ...structure.resistance].filter(
    (l) => l.price !== price,
  );
  return others.some((l) => Math.abs(l.price - price) <= tol);
}

export function buildForecastPathFromTrade(
  market: AgentMarketContext,
  rec: { entry: number; target: number },
): Array<{ time: number; price: number }> {
  const candles = market.currentTfCandles;
  const lastTime = candles.at(-1)?.time ?? Date.now();
  const current = market.currentPrice ?? rec.entry;
  const step = estimateBarMs(candles);
  return [
    { time: lastTime, price: current },
    { time: lastTime + step, price: rec.entry },
    { time: lastTime + step * 3, price: rec.target },
  ];
}

function estimateBarMs(candles: AgentCandle[]): number {
  if (candles.length < 2) return 60_000;
  const a = candles.at(-1)!.time;
  const b = candles.at(-2)!.time;
  const d = Math.abs(a - b);
  return d > 0 ? d : 60_000;
}

function approxAtr(candles: AgentCandle[]): number | null {
  if (candles.length < 2) return null;
  const window = candles.slice(-14);
  const trs = window.map((c) => c.high - c.low).filter((x) => x > 0);
  if (!trs.length) return null;
  return trs.reduce((a, b) => a + b, 0) / trs.length;
}

function clamp(n: number): number {
  return Math.max(0, Math.min(100, n));
}
