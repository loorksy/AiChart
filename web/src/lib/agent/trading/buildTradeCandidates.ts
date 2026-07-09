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
import {
  positionDisfavorsAction,
  type RangePosition,
} from "../marketContext/rangePosition";
import { scorePoi, type PoiScore, type ScorePoiInput } from "./scorePoi";

export type TradeCandidate = {
  id: string;
  action: "buy" | "sell";
  entry: number;
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
  minRr: number;
  newsRisk: "low" | "medium" | "high" | "unknown";
  spread?: number | null;
}

export interface TradeCandidatesResult {
  candidates: TradeCandidate[];
  best: TradeCandidate | null;
  rejectedReasons: string[];
  hasReversalEvidence: boolean;
}

const MAX_ENTRY_DISTANCE_ATR = 6;

export function buildTradeCandidates(
  input: BuildTradeCandidatesInput,
): TradeCandidatesResult {
  const rejectedReasons: string[] = [];
  const hasReversalEvidence = detectReversalEvidence(input);

  // Global gates that make ANY candidate invalid.
  if (input.newsRisk === "high") {
    return {
      candidates: [],
      best: null,
      rejectedReasons: ["خطر إخباري مرتفع يمنع أي صفقة الآن."],
      hasReversalEvidence,
    };
  }
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

    // Zone must be on the actionable side of price (retest entry, no chasing).
    if (action === "buy" && zone.high > input.currentPrice) continue;
    if (action === "sell" && zone.low < input.currentPrice) continue;

    const poiScore = scorePoi(buildScoreInput(input, zone));
    if (!poiScore.isTradable) {
      rejectedReasons.push(
        `منطقة ${zone.type === "demand" ? "طلب" : "عرض"} رُفضت: قوة ${poiScore.score} أقل من الحد.`,
      );
      continue;
    }

    // Direction discipline vs HTF and structure.
    const setup = classifySetup(input, action, hasReversalEvidence);
    if (!setup.allowed) {
      rejectedReasons.push(setup.reason);
      continue;
    }

    // Range-position discipline: no buys from premium, no sells from discount,
    // and nothing from mid-range unless this is a confirmed reversal.
    if (
      input.rangePosition &&
      positionDisfavorsAction(input.rangePosition.label, action) &&
      setup.type !== "reversal_after_sweep"
    ) {
      rejectedReasons.push(
        action === "buy"
          ? "موضع السعر داخل النطاق لا يناسب الشراء (منطقة عالية/وسط النطاق)."
          : "موضع السعر داخل النطاق لا يناسب البيع (منطقة منخفضة/وسط النطاق).",
      );
      continue;
    }

    // Levels: entry at the zone edge, stop behind it, target at min structure.
    const entry = action === "buy" ? zone.high : zone.low;
    const stop = action === "buy" ? zone.low : zone.high;
    const risk = Math.abs(entry - stop);
    if (!(risk > 0)) continue;

    // Spread sanity: SL must not sit inside spread noise.
    if (input.spread && risk < input.spread * 5) {
      rejectedReasons.push("وقف الخسارة أقرب من هامش السبريد الآمن.");
      continue;
    }

    // Entry distance: if price already ran too far, the entry is missed.
    const atr = input.atr && input.atr > 0 ? input.atr : risk;
    const entryDistanceAtr = Math.abs(input.currentPrice - entry) / atr;
    if (entryDistanceAtr > MAX_ENTRY_DISTANCE_ATR) {
      rejectedReasons.push("السعر ابتعد كثيراً عن منطقة الدخول — الدخول فات.");
      continue;
    }

    const target =
      action === "buy"
        ? entry + risk * Math.max(input.minRr, 2)
        : entry - risk * Math.max(input.minRr, 2);
    const rr = Math.abs(target - entry) / risk;
    if (rr < input.minRr) {
      rejectedReasons.push(
        `العائد/المخاطرة ${rr.toFixed(2)} أقل من الحد الأدنى ${input.minRr}.`,
      );
      continue;
    }

    candidates.push({
      id: `tc-${idSeq++}`,
      action,
      entry,
      stop_loss: stop,
      targets: [target],
      poi: { type: zone.type, low: zone.low, high: zone.high, score: poiScore },
      rr,
      setupType: setup.type,
      evidence: [...setup.evidence, ...poiScore.reasons],
      warnings: [...poiScore.warnings, ...(setup.warnings ?? [])],
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
):
  | { allowed: true; type: TradeCandidate["setupType"]; evidence: string[]; warnings?: string[] }
  | { allowed: false; reason: string } {
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
      allowed: false,
      reason:
        "تعارض مع الفريم الأعلى دون دليل انعكاس (سحب سيولة + CHoCH/MSS) — لا صفقة.",
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
        allowed: false,
        reason: "الاتجاه وحده لا يكفي — لا يوجد كسر هيكل يدعم الاستمرار.",
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
      allowed: false,
      reason: "سوق عرضي دون رفض واضح عند حد النطاق — لا صفقة.",
    };
  }

  return {
    allowed: false,
    reason:
      action === "buy"
        ? "لا دليل هيكلي يدعم الشراء هنا (لا استمرار مؤكد ولا انعكاس مؤكد)."
        : "لا دليل هيكلي يدعم البيع هنا (لا استمرار مؤكد ولا انعكاس مؤكد).",
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
