/** Evidence checklist for the final model. It never chooses or blocks a side. */
import type { AgentMarketContext } from "../marketContext/buildAgentMarketContext";
import type { StructureResult } from "../agents/structureAgent";
import type { LiquidityResult } from "../agents/liquidityAgent";
import type { MultiTimeframeResult } from "../agents/multiTimeframeAgent";
import type { NewsMacroResult } from "../agents/newsMacroAgent";
import type { RangePosition } from "../marketContext/rangePosition";
import type { TradeCandidate, TradeCandidatesResult } from "./buildTradeCandidates";
import { meetsDataQuality } from "../dataQualityPolicy";
import { isSpreadTooHigh } from "../risk/spreadCheck";

export type TradingChecklistItem = {
  id: string;
  label: string;
  status: "pass" | "fail" | "warning" | "unknown";
  reason: string;
  weight: number;
};

export type TradingPlaybookResult = {
  checklist: TradingChecklistItem[];
  blockingReasons: string[];
  warnings: string[];
};

export interface TradingPlaybookInput {
  market: AgentMarketContext;
  structure: StructureResult | null;
  liquidity: LiquidityResult | null;
  mtf: MultiTimeframeResult | null;
  news: NewsMacroResult | null;
  rangePosition: RangePosition | null;
  candidatesResult: TradeCandidatesResult;
  candidate: TradeCandidate | null;
  educationalOnly?: boolean;
}

export function runTradingPlaybook(
  input: TradingPlaybookInput,
): TradingPlaybookResult {
  const items: TradingChecklistItem[] = [];
  const c = input.candidate;
  const market = input.market;

  const add = (
    id: string,
    label: string,
    status: TradingChecklistItem["status"],
    reason: string,
    weight: number,
  ) => items.push({
    id,
    label,
    status: status === "fail" ? "warning" : status,
    reason,
    weight,
  });

  // 1. Data quality (trade gate).
  const dataOk = meetsDataQuality(market.dataQuality, "trade");
  add(
    "data_quality",
    "تغطية الشموع كافية للتوصية",
    dataOk ? "pass" : "fail",
    dataOk
      ? `التغطية كافية (${market.dataQuality.currentTfCount} شمعة).`
      : "تغطية الشموع أقل من حد التوصية — طُلب استكمال البيانات.",
    10,
  );

  // 2. Market open / stale-data acceptability.
  const freshnessOk = market.freshness.isFresh;
  add(
    "market_open",
    "السوق مفتوح أو البيانات مقبولة",
    freshnessOk ? "pass" : market.marketOpen ? "fail" : "warning",
    freshnessOk
      ? "البيانات حديثة."
      : market.marketOpen
        ? "الشموع متأخرة والسوق مفتوح — لا توصية على بيانات قديمة."
        : "السوق مغلق — التحليل تعليمي فقط دون تنفيذ.",
    9,
  );

  // 3. HTF alignment or reversal evidence.
  const htfConflict = Boolean(input.mtf?.conflict);
  const hasReversal = input.candidatesResult.hasReversalEvidence;
  add(
    "htf_alignment",
    "الفريم الأعلى متوافق أو يوجد دليل انعكاس",
    !htfConflict ? "pass" : hasReversal ? "warning" : "fail",
    !htfConflict
      ? "لا تعارض مع الفريم الأعلى."
      : hasReversal
        ? "تعارض مع الفريم الأعلى لكن يوجد دليل انعكاس (سحب سيولة + تحول هيكلي)."
        : "تعارض مع الفريم الأعلى دون دليل انعكاس.",
    9,
  );

  // 4. Not mid-range.
  const rangeLabel = input.rangePosition?.label ?? "unknown";
  const midRange = rangeLabel === "mid_range";
  add(
    "range_position",
    "السعر ليس في منتصف النطاق",
    midRange ? "fail" : rangeLabel === "unknown" ? "unknown" : "pass",
    midRange
      ? "السعر في منتصف النطاق — لا ميزة سعرية للدخول."
      : rangeLabel === "unknown"
        ? "موضع النطاق غير محدد."
        : `موضع السعر: ${rangeLabel}.`,
    7,
  );

  // 5+6. Valid POI with sufficient strength.
  add(
    "poi_exists",
    "توجد منطقة POI صالحة",
    c ? "pass" : "fail",
    c
      ? `POI ${c.poi.type} بدرجة ${c.poi.score.grade} (${c.poi.score.score}).`
      : input.candidatesResult.rejectedReasons[0] ??
          "لا منطقة POI قوية قابلة للتداول.",
    10,
  );
  add(
    "poi_strength",
    "قوة POI كافية",
    c ? (c.poi.score.grade === "A" ? "pass" : "warning") : "fail",
    c
      ? c.poi.score.grade === "A"
        ? "منطقة قوية (A)."
        : "منطقة مقبولة بحذر (B) — ثقة أقل."
      : "لا منطقة تتجاوز حد القوة.",
    8,
  );

  // 7. Liquidity context.
  const sweeps = input.liquidity?.sweeps ?? [];
  add(
    "liquidity_context",
    "سياق السيولة يدعم الإعداد",
    c
      ? sweeps.length
        ? "pass"
        : "warning"
      : "unknown",
    c
      ? sweeps.length
        ? "توجد أحداث سيولة داعمة في السياق."
        : "لا سحب سيولة واضح — الاعتماد على البنية فقط."
      : "لا إعداد لتقييم سياق السيولة.",
    5,
  );

  // 8. BOS/CHoCH confirmation.
  const latestEvent = input.structure?.latestStructureEvent;
  add(
    "structure_confirmation",
    "البنية تؤكد الإعداد (BOS/CHoCH)",
    c ? (latestEvent ? "pass" : "warning") : "unknown",
    latestEvent
      ? `آخر حدث هيكلي: ${latestEvent.type} ${latestEvent.direction === "bullish" ? "صاعد" : "هابط"} بقوة ${latestEvent.strength}.`
      : "لا حدث هيكلي حديث مؤكد.",
    7,
  );

  // 9. Not chasing price.
  const chasing =
    c != null &&
    market.currentPrice != null &&
    Math.abs(market.currentPrice - c.entry) <=
      (market.spread ?? 0.00001) * 2 &&
    c.poi.score.grade !== "A";
  add(
    "no_chasing",
    "الدخول ليس مطاردة للسعر الحالي",
    c ? (chasing ? "fail" : "pass") : "unknown",
    chasing
      ? "الدخول يساوي السعر الحالي دون منطقة قوية — مطاردة."
      : "الدخول مبني على إعادة اختبار منطقة، لا على السعر اللحظي.",
    6,
  );

  // 10. Reward/risk.
  add(
    "reward_risk",
    "العائد/المخاطرة التقديري",
    c ? "pass" : "unknown",
    c ? `RR تقديري = ${c.rr.toFixed(2)}.` : "لا إعداد لحساب العائد/المخاطرة.",
    9,
  );

  // 11. Spread.
  const spreadBad =
    c != null &&
    market.spread != null &&
    market.spread > 0 &&
    isSpreadTooHigh({
      spread: market.spread,
      atr: market.atr ?? 0,
      stopDistance: Math.abs(c.entry - c.stop_loss),
    });
  add(
    "spread",
    "السبريد مقبول",
    market.spread == null ? "unknown" : spreadBad ? "fail" : "pass",
    market.spread == null
      ? "السبريد غير متاح."
      : spreadBad
        ? "السبريد مرتفع نسبةً إلى التذبذب/الوقف."
        : "السبريد ضمن الحدود.",
    6,
  );

  // 12. News risk.
  const newsRisk = input.news?.newsRisk ?? "unknown";
  add(
    "news_risk",
    "خطر الأخبار لا يمنع الصفقة",
    newsRisk === "high"
      ? "fail"
      : newsRisk === "medium"
        ? "warning"
        : newsRisk === "unknown"
          ? "unknown"
          : "pass",
    newsRisk === "high"
      ? "حدث عالي التأثير قريب — لا تنفيذ."
      : newsRisk === "medium"
        ? "خطر إخباري متوسط — ثقة أقل."
        : newsRisk === "unknown"
          ? "خطر الأخبار غير معروف (المزوّد غير مفعّل)."
          : "لا خطر إخباري فوري.",
    8,
  );

  // Evidence summary only. The model is the recommendation authority.
  const blockingReasons: string[] = [];
  const warnings = items
    .filter((i) => i.status === "warning")
    .map((i) => i.reason);

  return {
    checklist: items,
    blockingReasons,
    warnings,
  };
}
