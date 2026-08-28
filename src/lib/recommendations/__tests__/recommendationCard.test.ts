/**
 * Recommendation-card numbers: the issued plan (entry, stop, every TP),
 * locale-aware labels, and the same signed R the report prints via displayROf.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { dirForLocale, t } from "@/lib/i18n";
import { realizedROf } from "@/lib/recommendations/tradeMetrics";
import { displayROf, liveRSoFar } from "@/lib/recommendations/tradeMetricsSummary";
import {
  REC_CARD_HEIGHT,
  REC_CARD_LOGO_SRC,
  REC_CARD_WIDTH,
  buildRecommendationCardModel,
  recommendationCardFilename,
  recommendationCardLabels,
  type RecommendationCardSource,
} from "@/lib/recommendations/recommendationCard";

const T0 = Date.UTC(2026, 7, 28, 10, 0, 0);
const XAU_ENTRY = 4601.99;
const XAU_SL = 4605.2;
const XAU_TP1 = 4583.76;
const XAU_TP2 = 4569.29;
const XAU_TP2_HONEST = 4578.42;

function rec(over: Partial<RecommendationCardSource> = {}): RecommendationCardSource {
  return {
    symbol: "XAUUSD",
    interval: "5m",
    direction: "sell",
    entryType: "market",
    entry: XAU_ENTRY,
    stopLoss: XAU_SL,
    targets: [XAU_TP1, XAU_TP2],
    outcome: "pending",
    status: "triggered",
    setupType: "scalp",
    planType: "immediate",
    executionState: "valid_now",
    createdAt: T0,
    expiresAt: T0 + 3_600_000,
    triggeredAt: T0,
    ...over,
  };
}

describe("buildRecommendationCardModel", () => {
  it("mirrors the issued plan: pair, side, timeframe, entry, stop, every TP", () => {
    const source = rec({
      entryLow: 4599.99,
      entryHigh: 4602.66,
      validityCandles: 36,
      revisionNo: 1,
    });
    const model = buildRecommendationCardModel(source, { locale: "ar", now: T0 });
    assert.equal(model.symbol, "XAUUSD");
    assert.equal(model.interval, "5m");
    assert.equal(model.direction, "sell");
    assert.equal(model.side, "short");
    assert.equal(model.entry, XAU_ENTRY);
    assert.equal(model.stopLoss, XAU_SL);
    assert.equal(model.targets.length, 2);
    assert.equal(model.targets[0]?.price, XAU_TP1);
    assert.equal(model.targets[1]?.price, XAU_TP2);
    assert.equal(model.entryZone?.low, 4599.99);
    assert.equal(model.entryZone?.high, 4602.66);
    assert.equal(model.validityCandles, 36);
    assert.equal(model.revisionNo, 1);
    assert.equal(model.setupType, "scalp");
    assert.equal(model.planType, "immediate");
    assert.equal(model.dir, "rtl");
    assert.equal(model.locale, "ar");
  });

  it("follows the app locale — Arabic RTL, English LTR — unlike the profit card", () => {
    const source = rec();
    const ar = buildRecommendationCardModel(source, { locale: "ar", now: T0 });
    const en = buildRecommendationCardModel(source, { locale: "en", now: T0 });
    assert.equal(ar.dir, "rtl");
    assert.equal(en.dir, "ltr");
    assert.equal(ar.dir, dirForLocale("ar"));
    const arLabels = recommendationCardLabels(ar);
    const enLabels = recommendationCardLabels(en);
    assert.equal(arLabels.signal, t("ar", "rec.card.sell"));
    assert.equal(enLabels.signal, t("en", "rec.card.sell"));
    assert.match(arLabels.signal, /[\u0600-\u06FF]/);
    assert.doesNotMatch(enLabels.signal, /[\u0600-\u06FF]/);
    assert.equal(arLabels.entry, t("ar", "rec.row.entry"));
    assert.equal(arLabels.stop, t("ar", "rec.row.stop_loss"));
    assert.equal(arLabels.target1, t("ar", "rec.row.target1"));
    assert.equal(arLabels.target2, t("ar", "rec.row.target2"));
    assert.equal(arLabels.setup, t("ar", "rec.setup_type.scalp"));
  });

  it("marks reached TPs on a closed TP2 win", () => {
    const source = rec({
      outcome: "win_tp2",
      status: "tp2_hit",
      tp1HitAt: T0 + 60_000,
      tp2HitAt: T0 + 120_000,
      tp1HitPrice: XAU_TP1,
      tp2HitPrice: XAU_TP2_HONEST,
    });
    const model = buildRecommendationCardModel(source, { locale: "ar", now: T0 + 180_000 });
    assert.equal(model.won, true);
    assert.equal(model.highestTp, 2);
    assert.equal(model.targets[0]?.hit, true);
    assert.equal(model.targets[1]?.hit, true);
    const labels = recommendationCardLabels(model);
    assert.equal(labels.goalStatus, t("ar", "rec.status.tp2_hit"));
    assert.equal(labels.footer, t("ar", "rec.footer.closed_win"));
    assert.equal(labels.tip, t("ar", "rec.tip.tp2"));
  });
});

describe("rec card R matches displayROf", () => {
  it("TP2 hit (honest zone print) is TP2's R — not TP1's 5.7R or price-percent", () => {
    const source = rec({
      outcome: "win_tp2",
      status: "tp2_hit",
      tp1HitAt: T0 + 60_000,
      tp2HitAt: T0 + 120_000,
      tp1HitPrice: XAU_TP1,
      tp2HitPrice: XAU_TP2_HONEST,
      realizedR: 5.68,
    });
    const model = buildRecommendationCardModel(source, { locale: "ar", now: T0 + 180_000 });
    const reportR = displayROf(source);
    assert.equal(model.rMultiple, reportR);
    assert.equal(model.rMultiple, realizedROf(source));
    assert.notEqual(formatSignedFrom(model.rMultiple), "+5.7R");
    assert.ok(model.rMultiple != null && model.rMultiple > 5.7);
    assert.equal(model.isLoss, false);
    assert.equal(model.markKind, "hit");
    assert.equal(model.markPrice, XAU_TP2_HONEST);
  });

  it("TP2 hit at the labeled line is TP2's R (~10.2R), not TP1", () => {
    const source = rec({
      outcome: "win_tp2",
      status: "tp2_hit",
      tp1HitAt: T0 + 60_000,
      tp2HitAt: T0 + 120_000,
      tp2HitPrice: XAU_TP2,
    });
    const model = buildRecommendationCardModel(source, { locale: "en", now: T0 + 180_000 });
    const reportR = displayROf(source);
    assert.equal(model.rMultiple, reportR);
    assert.equal(formatSignedFrom(model.rMultiple), "+10.2R");
    assert.notEqual(formatSignedFrom(model.rMultiple), "+5.7R");
  });

  it("an open short matches the rec's live R", () => {
    const source = rec({ outcome: "pending", status: "triggered" });
    const live = 4593.345;
    const model = buildRecommendationCardModel(source, {
      locale: "ar",
      livePrice: live,
      now: T0 + 30_000,
    });
    const reportR = displayROf(source, live);
    assert.equal(model.rMultiple, reportR);
    assert.equal(model.rMultiple, liveRSoFar(source, live));
    assert.ok(model.rMultiple != null && model.rMultiple > 0);
  });
});

describe("recommendationCardFilename", () => {
  it("is a PNG name distinct from the profit-card download", () => {
    const name = recommendationCardFilename({ symbol: "XAUUSD", side: "short", dateMs: T0 });
    assert.match(name, /^lonora-xauusd-short-rec-2026-08-28\.png$/);
    assert.match(name, /-rec-/);
  });
});

describe("compact rec card size", () => {
  it("is 360×520 — not the 360×400 profit receipt and not a 580 poster", () => {
    assert.equal(REC_CARD_WIDTH, 360);
    assert.equal(REC_CARD_HEIGHT, 520);
    assert.notEqual(REC_CARD_HEIGHT, 400);
    assert.ok(REC_CARD_HEIGHT > 400);
    assert.ok(REC_CARD_HEIGHT < 580);
    assert.equal(REC_CARD_LOGO_SRC, "/brand/aichart-mark-dark.png");
  });
});

function formatSignedFrom(value: number | null): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  const body = Math.abs(value).toFixed(1);
  if (value > 0) return `+${body}R`;
  if (value < 0) return `-${body}R`;
  return "0.0R";
}
