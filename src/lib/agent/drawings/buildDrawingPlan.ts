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
import { computeRangePosition } from "../marketContext/rangePosition";
import { DATA_QUALITY_POLICY } from "../dataQualityPolicy";
import { geometryToDrawings, type GeometrySnapshot } from "@/lib/chart/geometry";
import type { ChartDrawing } from "@/lib/chartDrawings";

/** Minimum candle history required before ANY level/zone drawing is trusted.
 *  Sourced from the central data-quality policy (drawing gate). */
export const MIN_CANDLES_FOR_DRAWINGS = DATA_QUALITY_POLICY.drawing;

/** Strength gate: a level/zone below this score is never drawn. */
export const DEFAULT_STRENGTH_THRESHOLD = 75;
export const MINIMAL_STRENGTH_THRESHOLD = 85;

/** Structure/liquidity/range annotations the plan may include (max a few). */
export type DrawingAnnotation = {
  type:
    | "bos"
    | "choch"
    | "sweep"
    | "range_high"
    | "range_low"
    | "premium_discount"
    | "invalidation";
  price: number;
  /** Second price for bands (premium_discount, invalidation zone). */
  price2?: number;
  time: number;
  label: string;
  strength: number;
  direction?: "bullish" | "bearish";
};

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
  /** BOS/CHoCH lines, sweep markers, range extremes, invalidation zone. */
  selectedAnnotations: DrawingAnnotation[];
  /** Scenario path — a POSSIBLE route, never a prediction guarantee. */
  forecastPath?: Array<{ time: number; price: number }>;
  /** Detected geometry drawings (trendlines/channels/patterns) — pre-built
   *  ChartDrawings from the shared engine, already strength-gated. */
  selectedGeometry: ChartDrawing[];
};

/** Hard cap: meaningful analysis, never chart clutter.
 *  Raised 7 → 9 when geometry landed so trendlines/patterns never evict the
 *  POI zones and levels that justify the trade itself. */
export const MAX_PLAN_OBJECTS = 9;
/** Geometry gets its own sub-budget inside MAX_PLAN_OBJECTS. */
export const MAX_GEOMETRY_OBJECTS = 3;

export interface DrawingPlanInput {
  decision: FinalDecisionResult;
  market: AgentMarketContext;
  structure: StructureResult | null;
  supplyDemand: SupplyDemandResult | null;
  liquidity: LiquidityResult | null;
  mtf: MultiTimeframeResult | null;
  /** Shared geometry snapshot (trendlines/channels/patterns). */
  geometry?: GeometrySnapshot | null;
  preferMinimalDrawings?: boolean;
  /** LLM-selected candidate ids (subset filter). The LLM can only SHRINK the
   *  candidate set — every selection is still strength-validated here. */
  selectedCandidateIds?: string[];
  /** LLM drawing veto. `shouldDraw:false` suppresses drawings; `true` cannot
   *  force weak levels through — validation still applies. */
  drawingAdvice?: { shouldDraw: boolean; reason: string } | null;
}

/**
 * Detector output packaged as CANDIDATES — never drawn directly. The LLM
 * synthesizer may pick meaningful ids; the plan then validates each pick.
 */
export type DrawingCandidate = {
  id: string;
  type:
    | "support"
    | "resistance"
    | "supply"
    | "demand"
    | "liquidity"
    | "bos"
    | "choch"
    | "sweep"
    | "range_high"
    | "range_low"
    | "premium_discount"
    | "invalidation"
    | "scenario_path";
  price?: number;
  low?: number;
  high?: number;
  time: number;
  computedStrength: number;
  evidence: string[];
};

export interface DrawingCandidateInput {
  market: AgentMarketContext;
  structure: StructureResult | null;
  supplyDemand: SupplyDemandResult | null;
  liquidity: LiquidityResult | null;
  mtf: MultiTimeframeResult | null;
}

/**
 * Builds the scored candidate list from detector output. Deterministic and
 * stable: the same inputs yield the same ids, so the synthesizer's selected
 * ids match what the plan re-derives.
 */
export function buildDrawingCandidates(
  input: DrawingCandidateInput,
): DrawingCandidate[] {
  const out: DrawingCandidate[] = [];

  (input.structure?.support ?? []).forEach((l, i) => {
    const strength = scoreLevel(l, input);
    out.push({
      id: `sup-${i}`,
      type: "support",
      price: l.price,
      time: l.time,
      computedStrength: strength,
      evidence: [`scored=${strength}`, "structure_support"],
    });
  });
  (input.structure?.resistance ?? []).forEach((l, i) => {
    const strength = scoreLevel(l, input);
    out.push({
      id: `res-${i}`,
      type: "resistance",
      price: l.price,
      time: l.time,
      computedStrength: strength,
      evidence: [`scored=${strength}`, "structure_resistance"],
    });
  });
  (input.supplyDemand?.zones ?? []).forEach((z, i) => {
    const strength = scoreZone(z, input);
    out.push({
      id: `zone-${i}`,
      type: z.type,
      low: z.low,
      high: z.high,
      time: z.time,
      computedStrength: strength,
      evidence: [`scored=${strength}`, "supply_demand_zone"],
    });
  });

  // Structure events (BOS/CHoCH/MSS) as annotation candidates.
  (input.structure?.structureEvents ?? []).forEach((ev, i) => {
    out.push({
      id: `ev-${i}`,
      type: ev.type === "BOS" ? "bos" : "choch",
      price: ev.brokenLevel,
      time: ev.breakCandleTime,
      computedStrength: ev.strength,
      evidence: [`${ev.type} ${ev.direction}`, `strength=${ev.strength}`],
    });
  });

  // Liquidity sweeps as annotation candidates.
  (input.liquidity?.sweeps ?? []).forEach((s, i) => {
    out.push({
      id: `sweep-${i}`,
      type: "sweep",
      price: s.sweptLevel,
      time: s.candleTime,
      computedStrength: s.strength,
      evidence: [
        s.side,
        s.followedByStructureShift ? "confirmed_by_structure" : "unconfirmed",
      ],
    });
  });

  return out;
}

/** True only when there is enough multi-timeframe history to draw reliably. */
export function hasSufficientDataForDrawings(market: AgentMarketContext): boolean {
  return (
    market.currentTfCandles.length >= MIN_CANDLES_FOR_DRAWINGS.currentTf &&
    market.higherTfCandles.length >= MIN_CANDLES_FOR_DRAWINGS.higherTf &&
    market.dailyCandles.length >= MIN_CANDLES_FOR_DRAWINGS.daily
  );
}

function noDrawPlan(reason: string): DrawingPlan {
  return {
    shouldDraw: false,
    reason,
    drawingIntent: "none",
    selectedLevels: [],
    selectedZones: [],
    selectedAnnotations: [],
    selectedGeometry: [],
  };
}

/**
 * Geometry drawings above the strength gate, invalidated patterns excluded,
 * bounded to the geometry sub-budget. Confidence maps 1:1 onto the plan's
 * 0–100 strength scale so the same threshold governs levels AND geometry.
 */
function selectGeometryDrawings(
  geometry: GeometrySnapshot | null | undefined,
  threshold: number,
): ChartDrawing[] {
  if (!geometry) return [];
  return geometryToDrawings(geometry)
    .filter((drawing) => (drawing.confidence ?? 0) >= threshold)
    .filter((drawing) => drawing.meta?.patternStatus !== "invalidated")
    .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))
    .slice(0, MAX_GEOMETRY_OBJECTS);
}

export function buildDrawingPlan(input: DrawingPlanInput): DrawingPlan {
  const threshold = input.preferMinimalDrawings
    ? MINIMAL_STRENGTH_THRESHOLD
    : DEFAULT_STRENGTH_THRESHOLD;
  const rec = input.decision.recommendation;

  // Hard data gate: never invent levels from a tiny candle window.
  if (!hasSufficientDataForDrawings(input.market)) {
    return noDrawPlan(
      "البيانات التاريخية غير كافية لرسم مستويات موثوقة. تم طلب استكمال البيانات.",
    );
  }

  // LLM drawing veto: the synthesizer may decide drawing would be misleading.
  // (It can only suppress — a `shouldDraw: true` never bypasses validation.)
  if (input.drawingAdvice && input.drawingAdvice.shouldDraw === false) {
    return noDrawPlan(
      input.drawingAdvice.reason || "قرر الوكيل أن الرسم الآن غير مفيد.",
    );
  }

  // --- Valid trade setup → POI + invalidation + evidence + scenario path. ---
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
      return noDrawPlan(
        "خطة الصفقة تفتقد منطقة POI صالحة أو مستويات دخول/وقف/هدف.",
      );
    }

    // Evidence annotations: invalidation zone + the strongest supporting
    // structure event / confirmed sweep. Kept small — no clutter.
    const annotations: DrawingAnnotation[] = [];
    const atr = input.market.atr ?? Math.abs(rec.entry - rec.stop_loss);
    const bandWidth = Math.min(Math.abs(rec.entry - rec.stop_loss) * 0.5, atr);
    annotations.push({
      type: "invalidation",
      price: rec.stop_loss,
      price2:
        rec.action === "buy"
          ? rec.stop_loss - bandWidth
          : rec.stop_loss + bandWidth,
      time: input.market.currentTfCandles.at(-1)?.time ?? Date.now(),
      label: "منطقة إبطال السيناريو",
      strength: 80,
    });
    annotations.push(...pickEvidenceAnnotations(input, 2));

    return {
      shouldDraw: true,
      reason: "خطة صفقة صالحة: منطقة POI + دخول + وقف + أهداف + إبطال.",
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
      selectedAnnotations: annotations.slice(0, 3),
      forecastPath: buildForecastPathFromTrade(input.market, {
        entry: rec.entry,
        target: rec.targets[rec.targets.length - 1]!,
      }),
      // The structural justification drawn WITH the trade: the trendline,
      // channel, or pattern the recommendation narrative can point at.
      selectedGeometry: selectGeometryDrawings(input.geometry, threshold),
    };
  }

  // --- WAIT → draw ONLY strong, validated zones/levels (or nothing). ---
  // Detector output becomes CANDIDATES; the LLM may pre-select meaningful ids
  // (shrink only), then every survivor is still strength-gated here.
  let candidates = buildDrawingCandidates(input);
  if (input.selectedCandidateIds?.length) {
    const selected = new Set(input.selectedCandidateIds);
    candidates = candidates.filter((c) => selected.has(c.id));
  }

  const levels = candidates
    .filter(
      (c): c is DrawingCandidate & { price: number } =>
        (c.type === "support" || c.type === "resistance" || c.type === "liquidity") &&
        c.price != null,
    )
    .map((c) => ({
      type: c.type as "support" | "resistance" | "liquidity",
      price: c.price,
      time: c.time,
      strength: c.computedStrength,
      reason: "مستوى مُقيَّم من البنية والسياق.",
    }))
    .filter((level) => level.strength >= threshold)
    .sort((a, b) => b.strength - a.strength)
    .slice(0, 3);

  const zones = candidates
    .filter(
      (c): c is DrawingCandidate & { low: number; high: number } =>
        (c.type === "supply" || c.type === "demand") &&
        c.low != null &&
        c.high != null,
    )
    .map((c) => ({
      type: c.type as "supply" | "demand",
      low: c.low,
      high: c.high,
      time: c.time,
      strength: c.computedStrength,
      reason: "منطقة عرض/طلب مُقيَّمة.",
    }))
    .filter((zone) => zone.strength >= threshold)
    .sort((a, b) => b.strength - a.strength)
    .slice(0, 2);

  // WAIT annotations: strong range extremes + confirmed structure/sweep
  // evidence only — never decorative.
  const annotations: DrawingAnnotation[] = [];
  const rangePos = computeRangePosition(
    input.market.currentTfCandles,
    input.market.currentPrice,
  );
  const strongRange =
    rangePos != null &&
    input.market.marketRegime === "range" &&
    (input.market.atr ?? 0) > 0 &&
    rangePos.rangeHigh - rangePos.rangeLow >= (input.market.atr ?? 0) * 3;
  if (strongRange && rangePos) {
    annotations.push(
      {
        type: "range_high",
        price: rangePos.rangeHigh,
        time: rangePos.rangeHighTime,
        label: "قمة النطاق",
        strength: 75,
      },
      {
        type: "range_low",
        price: rangePos.rangeLow,
        time: rangePos.rangeLowTime,
        label: "قاع النطاق",
        strength: 75,
      },
      {
        type: "premium_discount",
        price: rangePos.equilibrium,
        time: rangePos.rangeLowTime,
        label: "منتصف النطاق (توازن)",
        strength: 65,
      },
    );
  }
  annotations.push(...pickEvidenceAnnotations(input, 2));

  const geometryDrawings = selectGeometryDrawings(input.geometry, threshold);

  if (!levels.length && !zones.length && !annotations.length && !geometryDrawings.length) {
    return noDrawPlan(
      "قرار انتظار دون مستويات أو مناطق قوية موثوقة — الرسم الآن سيكون مضللاً.",
    );
  }

  // Cap total drawn objects — analysis, not clutter. Geometry spends its own
  // sub-budget first; levels/zones/annotations share the remainder.
  const budget = MAX_PLAN_OBJECTS - geometryDrawings.length;
  const cappedLevels = levels.slice(0, Math.min(3, Math.max(0, budget)));
  const cappedZones = zones.slice(
    0,
    Math.max(0, Math.min(2, budget - cappedLevels.length)),
  );
  const cappedAnnotations = annotations.slice(
    0,
    Math.max(0, budget - cappedLevels.length - cappedZones.length),
  );

  return {
    shouldDraw: true,
    reason: "قرار انتظار مع مناطق/مستويات وأدلة هيكلية عالية القوة فقط.",
    drawingIntent: "wait_zones",
    selectedLevels: cappedLevels,
    selectedZones: cappedZones,
    selectedAnnotations: cappedAnnotations,
    selectedGeometry: geometryDrawings,
  };
}

/**
 * The strongest structure event + the latest CONFIRMED sweep as annotations.
 * Weak or unconfirmed evidence is never drawn.
 */
function pickEvidenceAnnotations(
  input: DrawingCandidateInput,
  max: number,
): DrawingAnnotation[] {
  const out: DrawingAnnotation[] = [];

  const strongestEvent = [...(input.structure?.structureEvents ?? [])]
    .filter((ev) => ev.strength >= 60)
    .sort((a, b) => b.strength - a.strength)[0];
  if (strongestEvent) {
    out.push({
      type: strongestEvent.type === "BOS" ? "bos" : "choch",
      price: strongestEvent.brokenLevel,
      time: strongestEvent.breakCandleTime,
      label:
        strongestEvent.type === "BOS"
          ? `BOS ${strongestEvent.direction === "bullish" ? "صاعد" : "هابط"}`
          : `${strongestEvent.type} ${strongestEvent.direction === "bullish" ? "صاعد" : "هابط"}`,
      strength: strongestEvent.strength,
      direction: strongestEvent.direction,
    });
  }

  const confirmedSweep = [...(input.liquidity?.sweeps ?? [])]
    .filter((s) => s.followedByStructureShift && s.strength >= 60)
    .at(-1);
  if (confirmedSweep) {
    out.push({
      type: "sweep",
      price: confirmedSweep.sweptLevel,
      time: confirmedSweep.candleTime,
      label:
        confirmedSweep.side === "buy_side"
          ? "سحب سيولة علوي"
          : "سحب سيولة سفلي",
      strength: confirmedSweep.strength,
    });
  }

  return out.slice(0, max);
}

// --- Scoring ---------------------------------------------------------------

/**
 * Score a support/resistance level 0–100 from real confluence factors:
 * touches, reaction size, liquidity, higher-timeframe alignment, on-screen
 * relevance — and penalize levels crowded next to another level (noise).
 */
export function scoreLevel(
  level: PriceLevel,
  input: DrawingCandidateInput,
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
  input: DrawingCandidateInput,
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
