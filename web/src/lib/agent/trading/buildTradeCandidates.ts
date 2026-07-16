/**
 * Trade-candidate builder — produces structurally valid, executable scalp
 * geometry for the final AI model. Direction (BUY/SELL/WAIT) remains the
 * model's sole authority; this module only supplies truthful levels.
 *
 * Hard geometry rules (product contract, not user settings):
 * - stop beyond real invalidation + bounded buffer;
 * - TP1 must clear minimum net R after spread/slippage;
 * - targets must come from real structure / liquidity / volatility evidence;
 * - POI strength alone never overrides unusable geometry;
 * - distant pending entries are classified as conditional, never "active now".
 */
import type { AgentCandle, SupplyDemandZone, TrendLabel } from "../marketContext/detectors";
import type { StructureEvent } from "../marketContext/structureEvents";
import type { LiquiditySweep } from "../marketContext/liquiditySweeps";
import type { RangePosition } from "../marketContext/rangePosition";
import { scorePoi, type PoiScore, type ScorePoiInput } from "./scorePoi";
import {
  SCALP_GEOMETRY,
  classifyActivation,
  computeNetR,
  inferTickSize,
  meetsExecutableGeometry,
  roundToTick,
  scoreCandidateQuality,
  type GeometryActivationClass,
  type SymbolGeometryMeta,
} from "./scalpGeometry";
import {
  analyzePathToEntry,
  type PathToEntryAnalysis,
} from "./pathToEntry";

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
  /** Gross R for TP1 (pre-cost). */
  rr: number;
  /** Net R for TP1 after spread/slippage. */
  netRr: number;
  netRrTp2?: number;
  activationClass: GeometryActivationClass;
  activationDistance: number;
  activationDistanceAtr: number;
  qualityScore: number;
  triggerCondition: string;
  pathToEntry?: PathToEntryAnalysis;
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
  interval?: string;
  symbolMeta?: SymbolGeometryMeta | null;
}

export interface TradeCandidatesResult {
  /** Executable candidates only (immediate or conditional). */
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
  const meta = input.symbolMeta ?? null;

  if (!(input.currentPrice > 0) || !input.zones.length) {
    return {
      candidates: [],
      best: null,
      rejectedReasons: ["لا توجد مناطق عرض/طلب صالحة للتقييم."],
      hasReversalEvidence,
    };
  }

  const atr = input.atr && input.atr > 0 ? input.atr : approxAtr(input.candles);
  const structuralPool = collectStructuralTargets(input);
  const candidates: TradeCandidate[] = [];
  let idSeq = 0;

  for (const zone of input.zones) {
    const action: "buy" | "sell" = zone.type === "demand" ? "buy" : "sell";
    const poiScore = scorePoi(buildScoreInput(input, zone));
    const setup = classifySetup(input, action, hasReversalEvidence);

    if (!poiScore.isTradable) {
      rejectedReasons.push(
        `منطقة ${zone.type} غير قابلة للتنفيذ (درجة ${poiScore.grade}).`,
      );
      continue;
    }

    const entryOptions = buildEntryOptions({
      action,
      zone,
      currentPrice: input.currentPrice,
      atr,
      meta,
      spread: input.spread,
    });

    let bestForZone: TradeCandidate | null = null;
    let zoneReject = "لا هندسة أهداف كافية لهذه المنطقة.";

    for (const entryOpt of entryOptions) {
      const buffer = stopBuffer({
        symbolPrice: input.currentPrice,
        spread: input.spread,
        atr,
        meta,
      });
      const stopRaw =
        action === "buy" ? zone.low - buffer : zone.high + buffer;
      const stop = roundToTick(stopRaw, meta);
      const entry = roundToTick(entryOpt.entry, meta);
      const risk = Math.abs(entry - stop);
      if (!(risk > 0)) continue;

      const targets = selectTargets({
        action,
        entry,
        stop,
        structuralPool,
        atr,
        spread: input.spread,
        meta,
      });
      if (!targets.tp1) {
        zoneReject = "لا هدف هيكلي حقيقي يحقق الحد الأدنى لهندسة السكالب.";
        continue;
      }

      const targetList = [targets.tp1, ...(targets.tp2 != null ? [targets.tp2] : [])];
      const geometry = meetsExecutableGeometry({
        action,
        entry,
        stop,
        targets: targetList,
        spread: input.spread,
        meta,
      });
      if (!geometry.ok) {
        zoneReject =
          geometry.reason === "tp1_net_r_below_minimum"
            ? `هندسة الهدف ضعيفة (صافي R≈${geometry.netTp1R.toFixed(2)} أقل من ${SCALP_GEOMETRY.minNetTp1R}).`
            : "ترتيب مستويات الدخول/الوقف/الهدف غير صالح.";
        continue;
      }

      const entryType = classifyEntryType({
        action,
        entry,
        currentPrice: input.currentPrice,
        tolerance: entryTolerance({
          symbolPrice: input.currentPrice,
          spread: input.spread,
          atr,
          meta,
        }),
      });
      const activationClass = classifyActivation({
        entry,
        currentPrice: input.currentPrice,
        atr,
        entryType,
      });
      if (activationClass === "non_executable") {
        zoneReject = "منطقة الدخول بعيدة جداً عن السعر الحالي للتنفيذ الآمن.";
        continue;
      }

      const activationDistance = Math.abs(entry - input.currentPrice);
      const activationDistanceAtr = atr > 0 ? activationDistance / atr : 0;
      const netRrTp2 =
        targets.tp2 != null
          ? computeNetR({
              action,
              entry,
              stop,
              target: targets.tp2,
              spread: input.spread,
              meta,
            })
          : undefined;
      const qualityScore = scoreCandidateQuality({
        poiScore: poiScore.score,
        netTp1R: geometry.netTp1R,
        netTp2R: netRrTp2 ?? null,
        activationDistanceAtr,
        structuralTargetCount: targets.structuralCount,
      });

      const warnings = [...poiScore.warnings, ...(setup.warnings ?? [])];
      if (input.newsRisk === "high") warnings.push("حدث إخباري عالي التأثير قريب.");
      if (input.htfConflict) warnings.push("يوجد تعارض مع الفريم الأعلى.");
      if (input.spread && risk < input.spread * 5) {
        warnings.push("الوقف قريب من السبريد.");
      }
      if (activationClass === "conditional") {
        warnings.push("الدخول مشروط بعودة السعر إلى المنطقة.");
      }

      const pathToEntry =
        activationClass === "conditional"
          ? analyzePathToEntry({
              action,
              currentPrice: input.currentPrice,
              entry,
              atr,
              independentTransitionEvidence: false,
              zoneAlreadyBroken:
                action === "buy"
                  ? input.currentPrice < zone.low - atr * 0.25
                  : input.currentPrice > zone.high + atr * 0.25,
              driftingAway:
                action === "buy"
                  ? input.currentPrice > entry + atr * 0.75
                  : input.currentPrice < entry - atr * 0.75,
            })
          : undefined;

      const candidate: TradeCandidate = {
        id: `tc-${idSeq++}`,
        action,
        entry,
        entryType:
          activationClass === "immediate" && entryType !== "market"
            ? "market"
            : entryType,
        stop_loss: stop,
        targets: targetList,
        poi: { type: zone.type, low: zone.low, high: zone.high, score: poiScore },
        rr: geometry.grossTp1R,
        netRr: geometry.netTp1R,
        netRrTp2,
        activationClass,
        activationDistance,
        activationDistanceAtr,
        qualityScore,
        triggerCondition: buildTriggerCondition({
          action,
          activationClass,
          entry,
          zone,
        }),
        pathToEntry,
        setupType: setup.type,
        evidence: [
          ...setup.evidence,
          ...poiScore.reasons,
          `دخول ${entryOpt.style}`,
          `صافي R للهدف الأول ≈ ${geometry.netTp1R.toFixed(2)}`,
          ...(pathToEntry ? [pathToEntry.summary] : []),
        ],
        warnings,
        invalidationReason:
          action === "buy"
            ? `إغلاق شمعة تحت ${stop} يُبطل السيناريو.`
            : `إغلاق شمعة فوق ${stop} يُبطل السيناريو.`,
      };

      if (!bestForZone || candidate.qualityScore > bestForZone.qualityScore) {
        bestForZone = candidate;
      }
    }

    if (bestForZone) candidates.push(bestForZone);
    else rejectedReasons.push(zoneReject);
  }

  const best =
    [...candidates].sort((a, b) => {
      const byQuality = b.qualityScore - a.qualityScore;
      if (Math.abs(byQuality) > 1e-9) return byQuality;
      const byNet = b.netRr - a.netRr;
      if (Math.abs(byNet) > 1e-9) return byNet;
      return a.activationDistance - b.activationDistance;
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
): {
  allowed: true;
  type: TradeCandidate["setupType"];
  evidence: string[];
  warnings?: string[];
} {
  const wantBias = action === "buy" ? "bullish" : "bearish";
  const trendAligned =
    (action === "buy" && input.trend === "uptrend") ||
    (action === "sell" && input.trend === "downtrend");
  const htfAligned = input.htfBias === wantBias;
  const directionConflictsHtf =
    input.htfBias !== "unknown" &&
    input.htfBias !== "neutral" &&
    input.htfBias !== wantBias;

  if ((input.htfConflict || directionConflictsHtf) && !hasReversalEvidence) {
    return {
      allowed: true,
      type: "breakout_retest",
      evidence: ["منطقة سعرية قابلة للتقييم."],
      warnings: ["تعارض مع الفريم الأعلى دون دليل انعكاس مؤكد."],
    };
  }

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
        `الاتجاه ${action === "buy" ? "صاعد" : "هابط"} مدعوم بكسر هيكل.`,
        ...(htfAligned ? ["الفريم الأعلى متوافق مع الاتجاه."] : []),
      ],
    };
  }

  if (reversalConfirmed && hasReversalEvidence) {
    return {
      allowed: true,
      type: "reversal_after_sweep",
      evidence: ["انعكاس مؤكد: سحب سيولة تبعه تحول هيكلي في اتجاه الصفقة."],
      warnings: ["صفقة انعكاسية — إدارة مخاطرة أشد."],
    };
  }

  if (input.trend === "range") {
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

function buildEntryOptions(input: {
  action: "buy" | "sell";
  zone: SupplyDemandZone;
  currentPrice: number;
  atr: number;
  meta?: SymbolGeometryMeta | null;
  spread?: number | null;
}): Array<{ entry: number; style: string }> {
  const { zone, action } = input;
  const mid = (zone.low + zone.high) / 2;
  const near = action === "buy" ? zone.high : zone.low;
  const deep = action === "buy" ? zone.low + (zone.high - zone.low) * 0.25 : zone.high - (zone.high - zone.low) * 0.25;
  const options = [
    { entry: near, style: "near_edge" },
    { entry: mid, style: "midpoint" },
    { entry: deep, style: "deeper_zone" },
  ];
  const tol = entryTolerance({
    symbolPrice: input.currentPrice,
    spread: input.spread,
    atr: input.atr,
    meta: input.meta,
  });
  if (Math.abs(input.currentPrice - near) <= tol) {
    options.unshift({ entry: input.currentPrice, style: "market_at_zone" });
  }
  // Deduplicate by rounded tick.
  const seen = new Set<string>();
  return options.filter((o) => {
    const key = roundToTick(o.entry, input.meta).toFixed(8);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function collectStructuralTargets(input: BuildTradeCandidatesInput): number[] {
  const swings = extractSwingLevels(input.candles);
  const fromZones = input.zones.flatMap((z) => [z.low, z.high]);
  const fromEvents = input.structureEvents.map((e) => e.brokenLevel);
  return [...input.htfLevels, ...fromZones, ...swings, ...fromEvents].filter(
    (n) => Number.isFinite(n) && n > 0,
  );
}

function extractSwingLevels(candles: AgentCandle[]): number[] {
  const out: number[] = [];
  for (let i = 2; i < candles.length - 2; i++) {
    const c = candles[i]!;
    const left = candles.slice(i - 2, i);
    const right = candles.slice(i + 1, i + 3);
    if (
      left.every((x) => x.high <= c.high) &&
      right.every((x) => x.high <= c.high)
    ) {
      out.push(c.high);
    }
    if (
      left.every((x) => x.low >= c.low) &&
      right.every((x) => x.low >= c.low)
    ) {
      out.push(c.low);
    }
  }
  return out;
}

function selectTargets(input: {
  action: "buy" | "sell";
  entry: number;
  stop: number;
  structuralPool: number[];
  atr: number;
  spread?: number | null;
  meta?: SymbolGeometryMeta | null;
}): { tp1: number | null; tp2: number | null; structuralCount: number } {
  const side = input.action === "buy" ? 1 : -1;
  const unique = [...new Set(input.structuralPool.map((p) => roundToTick(p, input.meta)))]
    .filter((level) =>
      input.action === "buy" ? level > input.entry : level < input.entry,
    )
    .sort((a, b) => (input.action === "buy" ? a - b : b - a));

  const scored = unique.map((level) => {
    const net = computeNetR({
      action: input.action,
      entry: input.entry,
      stop: input.stop,
      target: level,
      spread: input.spread,
      meta: input.meta,
    });
    return { level, net };
  });

  const tp1 =
    scored.find((s) => s.net + 1e-9 >= SCALP_GEOMETRY.minNetTp1R)?.level ?? null;
  if (tp1 == null) {
    return { tp1: null, tp2: null, structuralCount: unique.length };
  }

  const tp2 =
    scored.find(
      (s) =>
        s.level !== tp1 &&
        s.net + 1e-9 >= SCALP_GEOMETRY.preferredTp2MinR &&
        s.net <= SCALP_GEOMETRY.preferredTp2MaxR + 0.75,
    )?.level ??
    scored.find(
      (s) =>
        s.level !== tp1 &&
        s.net + 1e-9 >= SCALP_GEOMETRY.preferredTp2MinR,
    )?.level ??
    null;

  // Optional ATR projection only when it lands near an existing structural level.
  if (tp2 == null && input.atr > 0) {
    const projected = roundToTick(
      input.entry + side * input.atr * SCALP_GEOMETRY.preferredTp2MinR,
      input.meta,
    );
    const nearStructural = unique.find(
      (level) => Math.abs(level - projected) <= input.atr * 0.35,
    );
    if (nearStructural && nearStructural !== tp1) {
      const net = computeNetR({
        action: input.action,
        entry: input.entry,
        stop: input.stop,
        target: nearStructural,
        spread: input.spread,
        meta: input.meta,
      });
      if (net + 1e-9 >= SCALP_GEOMETRY.preferredTp2MinR) {
        return {
          tp1,
          tp2: nearStructural,
          structuralCount: unique.length,
        };
      }
    }
  }

  return { tp1, tp2, structuralCount: unique.length };
}

function buildTriggerCondition(input: {
  action: "buy" | "sell";
  activationClass: GeometryActivationClass;
  entry: number;
  zone: SupplyDemandZone;
}): string {
  if (input.activationClass === "immediate") {
    return input.action === "buy"
      ? "الدخول متاح قرب منطقة الطلب الحالية مع استمرار الدليل الصاعد."
      : "الدخول متاح قرب منطقة العرض الحالية مع استمرار الدليل الهابط.";
  }
  return input.action === "buy"
    ? `فكرة الشراء تصبح قابلة للتنفيذ فقط إذا عاد السعر إلى منطقة الطلب حول ${input.entry} وأظهر رفضاً صاعداً أو تحولاً هيكلياً.`
    : `فكرة البيع تصبح قابلة للتنفيذ فقط إذا عاد السعر إلى منطقة العرض حول ${input.entry} وأظهر رفضاً هابطاً أو تحولاً هيكلياً.`;
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
  meta?: SymbolGeometryMeta | null;
}): number {
  const minTick = inferTickSize(input.symbolPrice, input.meta);
  return Math.max(
    input.spread && input.spread > 0 ? input.spread : 0,
    input.atr && input.atr > 0 ? input.atr * 0.15 : 0,
    minTick * MIN_TICK_MULTIPLIER,
  );
}

export function stopBuffer(input: {
  symbolPrice: number;
  spread?: number | null;
  atr?: number | null;
  meta?: SymbolGeometryMeta | null;
}): number {
  const minTick = inferTickSize(input.symbolPrice, input.meta);
  return Math.max(
    input.spread && input.spread > 0 ? input.spread * 2 : 0,
    input.atr && input.atr > 0 ? input.atr * 0.1 : 0,
    minTick * MIN_TICK_MULTIPLIER,
  );
}

function approxAtr(candles: AgentCandle[]): number {
  if (candles.length < 2) return 0;
  const window = candles.slice(-14);
  let sum = 0;
  for (let i = 1; i < window.length; i++) {
    const cur = window[i]!;
    const prev = window[i - 1]!;
    sum += Math.max(
      cur.high - cur.low,
      Math.abs(cur.high - prev.close),
      Math.abs(cur.low - prev.close),
    );
  }
  return sum / Math.max(1, window.length - 1);
}
