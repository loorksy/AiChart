import { buildForexSnapshot } from "./market";
import { DEFAULT_MARKET } from "@/lib/marketPolicy";
import { detectStructureLevels, type StructureAnalysis } from "./ohlc/structure";
import { fetchOhlc } from "./ohlc/fetchOhlc";
import { getEffectiveMinRr } from "./riskGuard";
import { computeRewardRisk } from "./rewardRisk";
import { updateRecommendationLevels, updateRecommendationContext } from "./store";
import type { MarketSnapshot } from "./market";
import type { MarketType } from "./markets/types";
import type { Recommendation, TradingSettings } from "./types";

export type SuggestedSide = "buy" | "sell" | "wait";

export interface EnrichResult {
  rec: Recommendation;
  directionSource: "agent" | "structure_override" | "structure";
  changed: boolean;
}

/** Deterministic side from structure + RSI / HTF trend. */
export function suggestSide(
  structure: StructureAnalysis | null,
  snap: MarketSnapshot,
): SuggestedSide {
  const struct = structure?.structure ?? "unknown";
  const rsi = snap.rsi14;

  if (struct === "uptrend") {
    if (rsi != null && rsi > 75) return "wait";
    return "buy";
  }
  if (struct === "downtrend") {
    if (rsi != null && rsi < 25) return "wait";
    return "sell";
  }
  if (struct === "range" && rsi != null) {
    if (rsi >= 70) return "sell";
    if (rsi <= 30) return "buy";
    return "wait";
  }

  if (snap.trend === "uptrend") return "buy";
  if (snap.trend === "downtrend") return "sell";
  return "wait";
}

function atrBuffer(snap: MarketSnapshot, price: number): number {
  const a = snap.atr14;
  if (a != null && a > 0) return a * 0.15;
  return Math.max(price * 0.001, 1e-8);
}

/** Adjust entry / SL / TP from structure and min R:R; validate direction. */
export function enrichRecommendationLevels(
  rec: Recommendation,
  structure: StructureAnalysis | null,
  snap: MarketSnapshot,
  settings: TradingSettings,
): EnrichResult {
  let action = rec.action;
  let entry = rec.entry;
  let stop_loss = rec.stop_loss;
  let take_profit = rec.take_profit;
  let rationale = rec.rationale ?? "";
  let directionSource: EnrichResult["directionSource"] = "agent";
  let changed = false;

  const suggested = suggestSide(structure, snap);
  const refPrice = snap.price || structure?.currentPrice || entry || 0;
  const minRr = getEffectiveMinRr(settings);

  if ((action === "buy" || action === "sell") && suggested !== "wait") {
    if (action !== suggested && (rec.confidence ?? 0) < 75) {
      action = "wait";
      directionSource = "structure_override";
      rationale =
        `${rationale}\n[تعديل]: اتجاه الوكيل (${rec.action}) يتعارض مع البنية (${suggested}) — انتظار.`.trim();
      changed = true;
    }
  }

  if (action !== "buy" && action !== "sell") {
    return { rec: { ...rec, action, rationale }, directionSource, changed };
  }

  const side = action as "buy" | "sell";
  const buffer = atrBuffer(snap, refPrice);

  if (!entry || entry <= 0) {
    if (side === "buy") {
      entry =
        structure?.nearestSupport ??
        structure?.swingLows?.slice(-1)[0] ??
        refPrice;
    } else {
      entry =
        structure?.nearestResistance ??
        structure?.swingHighs?.slice(-1)[0] ??
        refPrice;
    }
    changed = true;
  }

  if (side === "buy") {
    const slCandidate =
      (structure?.nearestSupport != null
        ? structure.nearestSupport - buffer
        : null) ??
      (structure?.swingLows?.length
        ? Math.min(...structure.swingLows.slice(-3)) - buffer
        : null);
    if (
      slCandidate != null &&
      slCandidate > 0 &&
      entry != null &&
      slCandidate < entry
    ) {
      const tooClose =
        take_profit != null &&
        Math.abs(stop_loss! - take_profit) < buffer * 2;
      if (
        !stop_loss ||
        stop_loss >= entry ||
        tooClose
      ) {
        stop_loss = slCandidate;
        changed = true;
      }
    }
  } else {
    const slCandidate =
      (structure?.nearestResistance != null
        ? structure.nearestResistance + buffer
        : null) ??
      (structure?.swingHighs?.length
        ? Math.max(...structure.swingHighs.slice(-3)) + buffer
        : null);
    if (
      slCandidate != null &&
      slCandidate > 0 &&
      entry != null &&
      slCandidate > entry
    ) {
      const tooClose =
        take_profit != null &&
        Math.abs(stop_loss! - take_profit) < buffer * 2;
      if (
        !stop_loss ||
        stop_loss <= entry ||
        tooClose
      ) {
        stop_loss = slCandidate;
        changed = true;
      }
    }
  }

  if (entry && stop_loss && entry !== stop_loss) {
    const risk = Math.abs(entry - stop_loss);
    const targetDist = risk * minRr;
    const tpCandidate =
      side === "buy" ? entry + targetDist : entry - targetDist;
    const rr =
      take_profit != null
        ? computeRewardRisk(entry, stop_loss, take_profit)
        : null;
    if (!take_profit || rr == null || rr < minRr) {
      take_profit = tpCandidate;
      changed = true;
    }
  }

  if (entry && stop_loss && take_profit) {
    const risk = Math.abs(entry - stop_loss);
    const reward = Math.abs(take_profit - entry);
    const invalid =
      side === "buy"
        ? stop_loss >= entry || take_profit <= entry
        : stop_loss <= entry || take_profit >= entry;
    if (invalid || reward < risk * 0.5) {
      action = "wait";
      directionSource = "structure_override";
      rationale =
        `${rationale}\n[رفض]: مستويات SL/TP غير صالحة هيكلياً.`.trim();
      changed = true;
    }
  }

  return {
    rec: {
      ...rec,
      action,
      entry: entry ?? rec.entry,
      stop_loss: stop_loss ?? rec.stop_loss,
      take_profit: take_profit ?? rec.take_profit,
      rationale,
    },
    directionSource,
    changed,
  };
}

/** Fetch structure + snap and persist enriched levels (chat + analyze paths). */
export async function enrichRecommendationAfterRecord(
  userId: number,
  rec: Recommendation,
  settings: TradingSettings,
  market?: MarketType,
): Promise<Recommendation> {
  const sym = rec.symbol;
  const interval = rec.timeframe ?? "1h";
  const mkt: MarketType = market ?? settings.active_market ?? DEFAULT_MARKET;

  const snap = await buildForexSnapshot(userId, sym, interval);

  const ohlc = await fetchOhlc({
    userId,
    symbol: sym,
    interval,
    market: mkt,
    limit: 120,
  }).catch(() => null);

  const structure =
    ohlc && ohlc.candles.length >= 10
      ? detectStructureLevels(ohlc.symbol, ohlc.interval, ohlc.candles)
      : null;

  const { rec: enriched, directionSource, changed } = enrichRecommendationLevels(
    rec,
    structure,
    snap,
    settings,
  );

  if (changed) {
    await updateRecommendationLevels(rec.id, {
      action: enriched.action,
      entry: enriched.entry,
      stop_loss: enriched.stop_loss,
      take_profit: enriched.take_profit,
      rationale: enriched.rationale,
    });
  }

  if (directionSource !== "agent" || changed) {
    let ctx: Record<string, unknown> = {};
    if (rec.context_json) {
      try {
        ctx = JSON.parse(rec.context_json) as Record<string, unknown>;
      } catch {
        ctx = {};
      }
    }
    ctx.direction_source = directionSource;
    await updateRecommendationContext(rec.id, JSON.stringify(ctx));
    enriched.context_json = JSON.stringify(ctx);
  }

  return enriched;
}
