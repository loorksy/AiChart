import type { StructureAnalysis } from "@/lib/ohlc/structure";
import type { OhlcCandle } from "@/lib/ohlc/fetchOhlc";
import { computeRewardRisk } from "@/lib/rewardRisk";
import type { TrendlineAnalysis } from "./trendlines";
import type { TradingStyle } from "@/lib/types";

export interface NormalizeTradeSetupInput {
  action: "buy" | "sell" | "wait";
  entry: number | null;
  stopLoss: number | null;
  targets: number[];
  candles: OhlcCandle[];
  atr: number | null;
  trendlines: TrendlineAnalysis | null;
  structure: StructureAnalysis | null;
  minRr: number;
  tradingStyle: TradingStyle;
}

export interface NormalizeTradeSetupResult {
  action: "buy" | "sell" | "wait";
  entry: number | null;
  stopLoss: number | null;
  targets: number[];
  issue: string | null;
  notes: string[];
}

const MIN_SCALP_CANDLES = 20;

export function minCandlesForStyle(style: TradingStyle): number {
  return style === "scalp" ? MIN_SCALP_CANDLES : 20;
}

function atrUnit(atr: number | null, refPrice: number): number {
  if (atr != null && atr > 0) return atr;
  return refPrice * 0.003;
}

/** Snap entry to support/resistance trendline touch when price is approaching POI. */
function poiEntryPrice(
  side: "buy" | "sell",
  refPrice: number,
  proposedEntry: number | null,
  atr: number,
  trendlines: TrendlineAnalysis | null,
  structure: StructureAnalysis | null,
): { entry: number; note: string | null; reject: string | null } {
  const line =
    side === "buy" ? trendlines?.support : trendlines?.resistance;
  const poi =
    side === "buy"
      ? structure?.nearestSupport ?? line?.projectedNow ?? null
      : structure?.nearestResistance ?? line?.projectedNow ?? null;

  const trendTouch = line?.projectedNow ?? null;
  const targetPoi = trendTouch ?? poi;

  if (targetPoi == null || !Number.isFinite(targetPoi)) {
    return { entry: refPrice, note: null, reject: null };
  }

  const price = proposedEntry ?? refPrice;
  const dist = Math.abs(price - targetPoi);
  const touchBand = atr * 0.6;
  const chaseBand = atr * 1.2;

  if (side === "buy") {
    if (refPrice < targetPoi - touchBand) {
      return {
        entry: refPrice,
        note: null,
        reject: "السعر تحت POI/خط الاتجاه — لا شراء قبل reclaim أو انتظار لمس الدعم.",
      };
    }
    if (price > targetPoi + chaseBand || refPrice > targetPoi + chaseBand) {
      return {
        entry: targetPoi,
        note: null,
        reject:
          "السعر بعيد عن خط الاتجاه — انتظر لمس POI بدل مطاردة السعر (limit عند الخط).",
      };
    }
    if (dist <= touchBand) {
      return {
        entry: targetPoi,
        note: `دخول عند لمس خط الاتجاه/POI @ ${targetPoi.toFixed(2)}`,
        reject: null,
      };
    }
    return {
      entry: targetPoi,
      note: `دخول limit قرب خط الاتجاه @ ${targetPoi.toFixed(2)}`,
      reject: null,
    };
  }

  if (refPrice > targetPoi + touchBand) {
    return {
      entry: refPrice,
      note: null,
      reject: "السعر فوق POI/خط المقاومة — لا بيع قبل رفض أو انتظار لمس المقاومة.",
    };
  }
  if (price < targetPoi - chaseBand || refPrice < targetPoi - chaseBand) {
    return {
      entry: targetPoi,
      note: null,
      reject: "السعر بعيد عن المقاومة — انتظر لمس POI.",
    };
  }
  if (dist <= touchBand) {
    return {
      entry: targetPoi,
      note: `دخول عند لمس المقاومة @ ${targetPoi.toFixed(2)}`,
      reject: null,
    };
  }
  return {
    entry: targetPoi,
    note: `دخول limit قرب المقاومة @ ${targetPoi.toFixed(2)}`,
    reject: null,
  };
}

function enforceMinRr(
  side: "buy" | "sell",
  entry: number,
  stopLoss: number,
  targets: number[],
  minRr: number,
): { stopLoss: number; targets: number[] } {
  const risk = Math.abs(entry - stopLoss);
  if (!(risk > 0)) return { stopLoss, targets };

  const minReward = risk * minRr;
  const first = targets.find((t) => Number.isFinite(t) && t > 0);
  let tp = first ?? (side === "buy" ? entry + minReward : entry - minReward);

  if (side === "buy") {
    if (tp <= entry) tp = entry + minReward;
    if (tp - entry < minReward) tp = entry + minReward;
  } else {
    if (tp >= entry) tp = entry - minReward;
    if (entry - tp < minReward) tp = entry - minReward;
  }

  const rest = targets.filter((t) => t !== first && t > 0);
  return { stopLoss, targets: [tp, ...rest] };
}

/**
 * Structure-first trade normalization: POI/trendline entry, min R:R, min candles.
 */
export function normalizeTradeSetup(
  input: NormalizeTradeSetupInput,
): NormalizeTradeSetupResult {
  const notes: string[] = [];
  let { action, entry, stopLoss, targets, candles, atr, trendlines, structure, minRr, tradingStyle } =
    input;

  if (action === "wait") {
    return { action, entry, stopLoss, targets, issue: null, notes };
  }

  const minBars = minCandlesForStyle(tradingStyle);
  if (candles.length < minBars) {
    return {
      action: "wait",
      entry: null,
      stopLoss: null,
      targets: [],
      issue: `تحويل إلى انتظار: يحتاج السكالب ${minBars}+ شمعة (${candles.length} متاحة).`,
      notes,
    };
  }

  const refPrice = candles[candles.length - 1]?.close ?? entry ?? 0;
  if (!(refPrice > 0)) {
    return {
      action: "wait",
      entry: null,
      stopLoss: null,
      targets: [],
      issue: "تحويل إلى انتظار: لا سعر مرجعي.",
      notes,
    };
  }

  const unit = atrUnit(atr, refPrice);
  const side = action;

  const poi = poiEntryPrice(side, refPrice, entry, unit, trendlines, structure);
  if (poi.reject) {
    return {
      action: "wait",
      entry: null,
      stopLoss: null,
      targets: [],
      issue: `تحويل إلى انتظار: ${poi.reject}`,
      notes,
    };
  }
  if (poi.note) notes.push(poi.note);
  entry = poi.entry;

  if (stopLoss == null || !Number.isFinite(stopLoss)) {
    stopLoss =
      side === "buy"
        ? (structure?.nearestSupport ?? entry - unit * 1.2)
        : (structure?.nearestResistance ?? entry + unit * 1.2);
    notes.push("وقف مُشتق من الهيكل/ATR");
  }

  const adjusted = enforceMinRr(side, entry, stopLoss, targets, minRr);
  stopLoss = adjusted.stopLoss;
  targets = adjusted.targets;

  const tp = targets[0] ?? null;
  const rr = computeRewardRisk(entry, stopLoss, tp);
  if (rr == null || rr < minRr) {
    return {
      action: "wait",
      entry: null,
      stopLoss: null,
      targets: [],
      issue: `تحويل إلى انتظار: R:R ${rr?.toFixed(2) ?? "—"} أقل من الحد ${minRr}.`,
      notes,
    };
  }

  const invalid =
    side === "buy"
      ? stopLoss >= entry || (tp != null && tp <= entry)
      : stopLoss <= entry || (tp != null && tp >= entry);
  if (invalid) {
    return {
      action: "wait",
      entry: null,
      stopLoss: null,
      targets: [],
      issue: "تحويل إلى انتظار: مستويات الدخول/الوقف/الهدف غير متسقة.",
      notes,
    };
  }

  return { action, entry, stopLoss, targets, issue: null, notes };
}

export function effectiveMinRrForStyle(
  settingsMinRr: number,
  style: TradingStyle,
): number {
  const floor = style === "scalp" ? 1.5 : style === "day" ? 1.5 : 1;
  return Math.max(settingsMinRr, floor);
}
