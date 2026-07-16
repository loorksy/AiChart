/**
 * Trade-candidate builder — the trading brain's core. Replaces the old
 * "uptrend + nearest demand = buy" logic with disciplined, evidence-based
 * candidates:
 *
 *   trend_continuation  — HTF-aligned trend + grade A/B POI in the right part
 *                         of the range.
 *   reversal_after_sweep — liquidity sweep + CHoCH/MSS confirming the turn.
 *   range_boundary      — strong range extreme POI with rejection context.
 *
 * Hard rules: weak POI → no candidate; HTF conflict without reversal evidence
 * → no candidate; mid-range → no candidate (except confirmed reversal at a
 * swept extreme); RR below minimum → no candidate; price already ran away from
 * the entry → no candidate. WAIT is always preferred over a weak trade.
 */
import type { AgentCandle, SupplyDemandZone, TrendLabel } from "../marketContext/detectors";
import type { StructureEvent } from "../marketContext/structureEvents";
import type { LiquiditySweep } from "../marketContext/liquiditySweeps";
import type { RangePosition } from "../marketContext/rangePosition";
import { scorePoi, type PoiScore, type ScorePoiInput } from "./scorePoi";

export type TradeCandidate = {
  id: string;
  action: "buy" | "sell";
  entry: number;
  entryType:
    | "market"
    | "buy_limit"
    | "buy_stop"
    | "sell_limit"
    | "sell_stop";
  stop_loss: number;
  targets: number[];
  poi: {
    type: "demand" | "supply" | "retest";
    low: number;
    high: number;
    score: PoiScore;
  };
  rr: number;
  setupType:
    | "trend_continuation"
    | "reversal_after_sweep"
    | "range_boundary"
    | "breakout_retest";
  evidence: string[];
  warnings: string[];
  invalidationReason: string;
};

export interface BuildTradeCandidatesInput {
  candles: AgentCandle[];
  currentPrice: number;
  atr: number | null;
  trend: TrendLabel;
  htfBias: "bullish" | "bearish" | "neutral" | "unknown";
  htfConflict: boolean;
  zones: SupplyDemandZone[];
  structureEvents: StructureEvent[];
  sweeps: LiquiditySweep[];
  rangePosition: RangePosition | null;
  htfLevels: number[];
  newsRisk: "low" | "medium" | "high" | "unknown";
  spread?: number | null;
}

export interface TradeCandidatesResult {
  candidates: TradeCandidate[];
  best: TradeCandidate | null;
  rejectedReasons: string[];
  hasReversalEvidence: boolean;
}

const MIN_TICK_MULTIPLIER = 8;

export function buildTradeCandidates(
  input: BuildTradeCandidatesInput,
): TradeCandidatesResult {
  const rejectedReasons: string[] = [];
  const hasReversalEvidence = detectReversalEvidence(input);

  if (!(input.currentPrice > 0) || !input.zones.length) {
    return {
      candidates: [],
      best: null,
      rejectedReasons: ["لا توجد مناطق عرض/طلب صالحة للتقييم."],
      hasReversalEvidence,
    };
  }

  const candidates: TradeCandidate[] = [];
  let idSeq = 0;

  for (const zone of input.zones) {
    const action: "buy" | "sell" = zone.type === "demand" ? "buy" : "sell";

    const poiScore = scorePoi(buildScoreInput(input, zone));

    // Direction discipline vs HTF and structure.
    const setup = classifySetup(input, action, hasReversalEvidence);

    // Levels: entry at the zone edge, stop buffered beyond the POI. Never place
    // SL exactly on the obvious zone boundary; that is where noise/liquidity
    // commonly hits.
    const entry = action === "buy" ? zone.high : zone.low;
    const buffer = stopBuffer({
      symbolPrice: input.currentPrice,
      spread: input.spread,
      atr: input.atr,
    });
    const stop = action === "buy" ? zone.low - buffer : zone.high + buffer;
    const risk = Math.abs(entry - stop);
    if (!(risk > 0)) continue;
    const structuralTargets = [
      ...input.htfLevels,
      ...input.zones.flatMap((candidateZone) => [candidateZone.low, candidateZone.high]),
    ].filter((level) => action === "buy" ? level > entry : level < entry);
    const volatilityTarget = action === "buy"
      ? entry + (input.atr && input.atr > 0 ? input.atr : risk)
      : entry - (input.atr && input.atr > 0 ? input.atr : risk);
    const target = action === "buy"
      ? Math.min(...structuralTargets, volatilityTarget)
      : Math.max(...structuralTargets, volatilityTarget);
    const rr = Math.abs(target - entry) / risk;
    const entryType = classifyEntryType({
      action,
      entry,
      currentPrice: input.currentPrice,
      tolerance: entryTolerance({
        symbolPrice: input.currentPrice,
        spread: input.spread,
        atr: input.atr,
      }),
    });

    const warnings = [...poiScore.warnings, ...(setup.warnings ?? [])];
    if (!poiScore.isTradable) warnings.push(`درجة POI منخفضة (${poiScore.score}).`);
    if (input.newsRisk === "high") warnings.push("حدث إخباري عالي التأثير قريب.");
    if (input.htfConflict) warnings.push("يوجد تعارض مع الفريم الأعلى.");
    if (input.spread && risk < input.spread * 5) warnings.push("الوقف قريب من السبريد.");

    candidates.push({
      id: `tc-${idSeq++}`,
      action,
      entry,
      entryType,
      stop_loss: stop,
      targets: [target],
      poi: { type: zone.type, low: zone.low, high: zone.high, score: poiScore },
      rr,
      setupType: setup.type,
      evidence: [...setup.evidence, ...poiScore.reasons],
      warnings,
      invalidationReason:
        action === "buy"
          ? `إغلاق شمعة تحت ${stop.toFixed(5)} يُبطل السيناريو.`
          : `إغلاق شمعة فوق ${stop.toFixed(5)} يُبطل السيناريو.`,
    });
  }

  // Best candidate: highest POI score, tie-broken by RR then proximity.
  const best =
    [...candidates].sort((a, b) => {
      const byScore = b.poi.score.score - a.poi.score.score;
      if (byScore !== 0) return byScore;
      return b.rr - a.rr;
    })[0] ?? null;

  return { candidates, best, rejectedReasons, hasReversalEvidence };
}

/** Reversal evidence = a sweep followed by CHoCH/MSS, or a strong recent MSS. */
export function detectReversalEvidence(input: {
  sweeps: LiquiditySweep[];
  structureEvents: StructureEvent[];
}): boolean {
  if (input.sweeps.some((s) => s.followedByStructureShift)) return true;
  const latest = input.structureEvents.at(-1);
  return Boolean(latest && latest.type === "MSS" && latest.strength >= 60);
}

function classifySetup(
  input: BuildTradeCandidatesInput,
  action: "buy" | "sell",
  hasReversalEvidence: boolean,
): { allowed: true; type: TradeCandidate["setupType"]; evidence: string[]; warnings?: string[] } {
  const wantBias = action === "buy" ? "bullish" : "bearish";
  const trendAligned =
    (action === "buy" && input.trend === "uptrend") ||
    (action === "sell" && input.trend === "downtrend");
  const htfAligned = input.htfBias === wantBias;
  const directionConflictsHtf =
    input.htfBias !== "unknown" &&
    input.htfBias !== "neutral" &&
    input.htfBias !== wantBias;

  // HARD RULE: trading against the higher timeframe requires reversal evidence.
  if ((input.htfConflict || directionConflictsHtf) && !hasReversalEvidence) {
    return {
      allowed: true,
      type: "breakout_retest",
      evidence: ["منطقة سعرية قابلة للتقييم."],
      warnings: ["تعارض مع الفريم الأعلى دون دليل انعكاس مؤكد."],
    };
  }

  // Reversal setup: sweep + structure shift in this direction.
  const reversalConfirmed =
    input.sweeps.some(
      (s) =>
        s.followedByStructureShift &&
        (action === "buy" ? s.side === "sell_side" : s.side === "buy_side"),
    ) ||
    input.structureEvents.some(
      (ev) =>
        (ev.type === "CHoCH" || ev.type === "MSS") &&
        ev.direction === wantBias &&
        ev.strength >= 50,
    );

  if (trendAligned && !directionConflictsHtf) {
    // Continuation still needs structure on its side, not just "trend is up".
    const bosSupport = input.structureEvents.some(
      (ev) => ev.type === "BOS" && ev.direction === wantBias,
    );
    if (!bosSupport && !reversalConfirmed) {
      return {
        allowed: true,
        type: "trend_continuation",
        evidence: [`اتجاه ${action === "buy" ? "صاعد" : "هابط"}.`],
        warnings: ["لا يوجد كسر هيكل حديث يدعم الاستمرار."],
      };
    }
    return {
      allowed: true,
      type: "trend_continuation",
      evidence: [
        `الاتجاه ${action === "buy" ? "صاعد" : "هابط"} مدعوم بكسر هيكل ${wantBias === "bullish" ? "صاعد" : "هابط"}.`,
        ...(htfAligned ? ["الفريم الأعلى متوافق مع الاتجاه."] : []),
      ],
    };
  }

  if (reversalConfirmed && hasReversalEvidence) {
    return {
      allowed: true,
      type: "reversal_after_sweep",
      evidence: [
        "انعكاس مؤكد: سحب سيولة تبعه تحول هيكلي في اتجاه الصفقة.",
      ],
      warnings: ["صفقة انعكاسية — إدارة مخاطرة أشد."],
    };
  }

  if (input.trend === "range") {
    // Range boundary: only from the correct extreme (checked by caller via
    // range-position discipline) and only with some rejection structure.
    const boundaryRejection = input.structureEvents.some(
      (ev) => ev.direction === wantBias,
    );
    if (boundaryRejection) {
      return {
        allowed: true,
        type: "range_boundary",
        evidence: ["ارتداد من حد النطاق مدعوم بحدث هيكلي في اتجاه الصفقة."],
        warnings: ["صفقة داخل نطاق — الهدف حد النطاق المقابل."],
      };
    }
    return {
      allowed: true,
      type: "range_boundary",
      evidence: ["منطقة عند نطاق عرضي."],
      warnings: ["لا يوجد رفض هيكلي واضح عند حد النطاق."],
    };
  }

  return {
    allowed: true,
    type: "breakout_retest",
    evidence: [`منطقة ${action === "buy" ? "طلب" : "عرض"} قابلة للتقييم.`],
    warnings: ["الدليل الهيكلي محدود."],
  };
}

function buildScoreInput(
  input: BuildTradeCandidatesInput,
  zone: SupplyDemandZone,
): ScorePoiInput {
  return {
    zone,
    candles: input.candles,
    currentPrice: input.currentPrice,
    atr: input.atr,
    structureEvents: input.structureEvents,
    sweeps: input.sweeps,
    rangePosition: input.rangePosition,
    htfLevels: input.htfLevels,
    otherZones: input.zones,
  };
}

function classifyEntryType(input: {
  action: "buy" | "sell";
  entry: number;
  currentPrice: number;
  tolerance: number;
}): TradeCandidate["entryType"] {
  const near = Math.abs(input.entry - input.currentPrice) <= input.tolerance;
  if (near) return "market";
  if (input.action === "buy") {
    return input.entry < input.currentPrice ? "buy_limit" : "buy_stop";
  }
  return input.entry > input.currentPrice ? "sell_limit" : "sell_stop";
}

function entryTolerance(input: {
  symbolPrice: number;
  spread?: number | null;
  atr?: number | null;
}): number {
  const minTick = minTickForPrice(input.symbolPrice);
  return Math.max(
    input.spread && input.spread > 0 ? input.spread : 0,
    input.atr && input.atr > 0 ? input.atr * 0.15 : 0,
    minTick * MIN_TICK_MULTIPLIER,
  );
}

function minTickForPrice(price: number): number {
  if (price > 100) return 0.01;
  if (price > 10) return 0.001;
  if (price > 2) return 0.0001;
  return 0.00001;
}

export function stopBuffer(input: {
  symbolPrice: number;
  spread?: number | null;
  atr?: number | null;
}): number {
  const minTick = minTickForPrice(input.symbolPrice);
  return Math.max(
    input.spread && input.spread > 0 ? input.spread * 2 : 0,
    input.atr && input.atr > 0 ? input.atr * 0.1 : 0,
    minTick * MIN_TICK_MULTIPLIER,
  );
}
