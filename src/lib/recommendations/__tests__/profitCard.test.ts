/**
 * Profit-card numbers: PnL %, long vs short, realized vs unrealized,
 * Western digits, Riyadh clock, download filename. No UI.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { dirForLocale } from "@/lib/i18n";
import { BRAND_URL } from "@/lib/brand";
import {
  PROFIT_CARD_COPY,
  PROFIT_CARD_GAIN_COLOR,
  PROFIT_CARD_HEIGHT,
  PROFIT_CARD_LOGO_SRC,
  PROFIT_CARD_LOSS_COLOR,
  PROFIT_CARD_SHARE_URL,
  PROFIT_CARD_WIDTH,
  buildProfitCardModel,
  formatCardDate,
  formatCardPrice,
  formatPnlPercent,
  pnlAccentColor,
  pnlPercentFromEntry,
  profitCardFilename,
  profitCardLabels,
  sideOf,
  type ProfitCardSource,
} from "@/lib/recommendations/profitCard";

const T0 = Date.UTC(2026, 7, 28, 10, 0, 0); // 13:00 in Riyadh (UTC+3)

function rec(over: Partial<ProfitCardSource> = {}): ProfitCardSource {
  return {
    symbol: "XAUUSD",
    direction: "buy",
    entry: 2600,
    stopLoss: 2580,
    targets: [2620, 2640, 2660],
    outcome: "pending",
    createdAt: T0,
    expiresAt: T0 + 3_600_000,
    ...over,
  };
}

describe("sideOf", () => {
  it("buy is long and sell is short", () => {
    assert.equal(sideOf("buy"), "long");
    assert.equal(sideOf("sell"), "short");
  });
});

describe("pnlPercentFromEntry", () => {
  it("long profit is (mark − entry) / entry as a percent", () => {
    assert.equal(pnlPercentFromEntry("buy", 2600, 2652.6), 2.02);
  });

  it("short profit is (entry − mark) / entry as a percent", () => {
    assert.equal(pnlPercentFromEntry("sell", 2600, 2548), 2);
  });

  it("a long that goes against the plan is negative", () => {
    assert.equal(pnlPercentFromEntry("buy", 2600, 2574), -1);
  });

  it("degenerate entry yields 0 rather than Infinity", () => {
    assert.equal(pnlPercentFromEntry("buy", 0, 2600), 0);
  });
});

describe("formatPnlPercent / formatCardPrice", () => {
  it("uses Western digits and a leading + on gains", () => {
    assert.equal(formatPnlPercent(164.72), "+164.72%");
    assert.equal(formatPnlPercent(-3.5), "−3.50%");
    assert.equal(formatPnlPercent(0), "0.00%");
    assert.doesNotMatch(formatPnlPercent(12.4), /[\u0660-\u0669]/);
  });

  it("formats prices with Western grouping", () => {
    assert.equal(formatCardPrice(2650.4), "2,650.40");
    assert.doesNotMatch(formatCardPrice(2650.4), /[\u0660-\u0669]/);
  });
});

describe("buildProfitCardModel", () => {
  it("an open buy against a live quote is unrealized PnL", () => {
    const model = buildProfitCardModel(
      rec({ triggeredAt: T0, outcome: "pending" }),
      { locale: "ar", livePrice: 2652, now: T0 + 60_000 },
    );
    assert.equal(model.kind, "unrealized");
    assert.equal(model.side, "long");
    assert.equal(model.markKind, "current");
    assert.equal(model.markPrice, 2652);
    assert.equal(model.pnlPct, 2);
    assert.equal(model.isLoss, false);
    assert.equal(model.dir, "ltr");
    assert.equal(model.rMultiple, null);
  });

  it("a TP hit is realized PnL at the hit price", () => {
    const model = buildProfitCardModel(
      rec({
        outcome: "win_tp1",
        triggeredAt: T0,
        tp1HitAt: T0 + 120_000,
        tp1HitPrice: 2620,
      }),
      { locale: "en", now: T0 + 180_000 },
    );
    assert.equal(model.kind, "realized");
    assert.equal(model.markKind, "hit");
    assert.equal(model.markPrice, 2620);
    assert.equal(model.pnlPct, Math.round(((2620 - 2600) / 2600) * 10000) / 100);
    assert.equal(model.dateMs, T0 + 120_000);
    assert.equal(model.dir, "ltr");
    assert.ok(model.rMultiple != null && model.rMultiple > 0);
  });

  it("a stopped short is a red, still-shareable loss card", () => {
    const model = buildProfitCardModel(
      rec({
        direction: "sell",
        outcome: "loss",
        triggeredAt: T0,
        slHitAt: T0 + 90_000,
        exitPrice: 2620,
        realizedR: -1,
      }),
      { locale: "ar", now: T0 + 120_000 },
    );
    assert.equal(model.kind, "realized");
    assert.equal(model.side, "short");
    assert.equal(model.isLoss, true);
    assert.ok(model.pnlPct < 0);
    assert.equal(model.markKind, "hit");
  });

  it("uses effectiveEntry when the fill differs from the label", () => {
    const model = buildProfitCardModel(
      rec({
        entry: 2600,
        effectiveEntry: 2605,
        outcome: "pending",
        triggeredAt: T0,
      }),
      { locale: "en", livePrice: 2631.05, now: T0 },
    );
    assert.equal(model.entry, 2605);
    assert.equal(model.pnlPct, 1);
  });

  it("points the QR/link at the live product URL — no invented referral", () => {
    const model = buildProfitCardModel(rec(), { locale: "ar", now: T0 });
    assert.equal(model.shareUrl, PROFIT_CARD_SHARE_URL);
    assert.match(model.shareUrl, /^https:\/\/aichart\.lork\.cloud$/);
    assert.equal(model.shareUrl, BRAND_URL.replace(/\/$/, ""));
    assert.doesNotMatch(model.shareUrl, /ref|LNR21GOLD|lonora\.com/i);
  });

  it("the share image is always LTR English, even when the app locale is Arabic", () => {
    const ar = buildProfitCardModel(rec(), { locale: "ar", now: T0 });
    const en = buildProfitCardModel(rec(), { locale: "en", now: T0 });
    assert.equal(ar.dir, "ltr");
    assert.equal(en.dir, "ltr");
    assert.equal(dirForLocale("ar"), "rtl");
    const labels = profitCardLabels(ar);
    assert.equal(labels.badge, PROFIT_CARD_COPY.badge);
    assert.equal(labels.pnlKind, PROFIT_CARD_COPY.unrealized);
    assert.equal(labels.side, PROFIT_CARD_COPY.long);
    assert.equal(labels.mark, PROFIT_CARD_COPY.lastPrice);
    assert.equal(labels.entry, PROFIT_CARD_COPY.entry);
    assert.equal(labels.date, PROFIT_CARD_COPY.date);
    assert.equal(labels.tagline, PROFIT_CARD_COPY.tagline);
    for (const value of Object.values(labels)) {
      assert.doesNotMatch(value, /[\u0600-\u06FF]/);
    }
    assert.deepEqual(labels, profitCardLabels(en));
  });

  it("realized / short / hit rows still speak English", () => {
    const model = buildProfitCardModel(
      rec({
        direction: "sell",
        outcome: "win_tp1",
        triggeredAt: T0,
        tp1HitAt: T0 + 120_000,
        tp1HitPrice: 2580,
      }),
      { locale: "ar", now: T0 + 180_000 },
    );
    const labels = profitCardLabels(model);
    assert.equal(labels.pnlKind, "Realized PnL");
    assert.equal(labels.side, "Short");
    assert.equal(labels.mark, "Hit Price");
    assert.doesNotMatch(labels.pnlKind, /[\u0600-\u06FF]/);
  });
});

describe("profitCardFilename", () => {
  it("is a PNG name with Western digits and no spaces", () => {
    const name = profitCardFilename({ symbol: "XAUUSD", side: "long", dateMs: T0 });
    assert.match(name, /^lonora-xauusd-long-2026-08-28\.png$/);
    assert.doesNotMatch(name, /[\u0660-\u0669\s]/);
  });

  it("strips junk from the symbol so the download stays a safe filename", () => {
    const name = profitCardFilename({ symbol: "XAU/USD", side: "short", dateMs: T0 });
    assert.equal(name, "lonora-xauusd-short-2026-08-28.png");
  });
});

describe("formatCardDate", () => {
  it("prints the Riyadh clock with Western digits", () => {
    const stamp = formatCardDate(T0);
    assert.match(stamp, /28/);
    assert.match(stamp, /2026/);
    assert.doesNotMatch(stamp, /[\u0660-\u0669]/);
    // 10:00 UTC → 13:00 in Riyadh.
    assert.match(stamp, /13:00/);
  });
});

describe("brand assets the card is allowed to use", () => {
  it("points at the real Lonora face-mark, not a decorative fake", () => {
    assert.equal(PROFIT_CARD_LOGO_SRC, "/brand/aichart-mark-dark.png");
  });
});

describe("pnlAccentColor", () => {
  it("is green on a gain and red on a loss — never gold", () => {
    assert.equal(pnlAccentColor(false), PROFIT_CARD_GAIN_COLOR);
    assert.equal(pnlAccentColor(true), PROFIT_CARD_LOSS_COLOR);
    assert.match(PROFIT_CARD_GAIN_COLOR, /^#20d68a$/i);
    assert.match(PROFIT_CARD_LOSS_COLOR, /^#f2555d$/i);
    assert.notEqual(PROFIT_CARD_GAIN_COLOR, PROFIT_CARD_LOSS_COLOR);
    assert.doesNotMatch(PROFIT_CARD_GAIN_COLOR, /#f0d078|#e8c04a|#c9a227|#f3e6c4/i);
    assert.doesNotMatch(PROFIT_CARD_LOSS_COLOR, /#f0d078|#e8c04a|#c9a227/i);
  });
});

describe("compact card size", () => {
  it("is 360 wide and shorter than the old 580 phone strip", () => {
    assert.equal(PROFIT_CARD_WIDTH, 360);
    assert.equal(PROFIT_CARD_HEIGHT, 400);
    assert.ok(PROFIT_CARD_HEIGHT <= 460);
    assert.ok(PROFIT_CARD_HEIGHT >= 360);
    assert.notEqual(PROFIT_CARD_HEIGHT, 580);
  });
});

