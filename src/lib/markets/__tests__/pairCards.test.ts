import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  changePct,
  downsample,
  formatChangePct,
  formatPairPrice,
  pricePrecision,
  sparklineGeometry,
} from "@/lib/markets/pairQuote";
import { currencyMark, pairMarks, FLAGGED_CURRENCIES } from "@/lib/markets/currencyFlags";

test("change is measured across the window, and absent when it cannot be", () => {
  assert.equal(changePct([100, 101]), 1);
  assert.equal(changePct([100, 99]), -1);
  // One point is not a move, and neither is no point — null, never a fake zero.
  assert.equal(changePct([100]), null);
  assert.equal(changePct([]), null);
  assert.equal(changePct([0, 5]), null);
  assert.equal(changePct([100, Number.NaN, 102]), 2);
});

test("each pair is quoted in its own precision", () => {
  assert.equal(pricePrecision("EURUSD"), 5);
  assert.equal(pricePrecision("USDJPY"), 3);
  assert.equal(pricePrecision("XAUUSD"), 2);
  // Broker suffixes must not change how a price reads.
  assert.equal(pricePrecision("EURUSDm"), 5);
  assert.equal(formatPairPrice("EURUSD", 1.08512345), "1.08512");
  assert.equal(formatPairPrice("XAUUSD", 2411.4567), "2411.46");
  assert.equal(formatPairPrice("EURUSD", null), "—");
});

test("a gain is signed as a gain", () => {
  assert.equal(formatChangePct(0.234), "+0.23%");
  assert.equal(formatChangePct(-0.02), "-0.02%");
  assert.equal(formatChangePct(0), "0.00%");
  assert.equal(formatChangePct(null), "—");
});

test("downsampling keeps the endpoints the percentage was computed from", () => {
  const series = Array.from({ length: 100 }, (_, i) => i);
  const thinned = downsample(series, 10);
  assert.equal(thinned.length, 10);
  assert.equal(thinned[0], 0);
  assert.equal(thinned[thinned.length - 1], 99);
  // Nothing to thin: the series passes through untouched.
  assert.deepEqual(downsample([1, 2, 3], 10), [1, 2, 3]);
});

test("sparkline geometry stays inside its box, flat series included", () => {
  const spark = sparklineGeometry([1, 2, 3, 2], 100, 40);
  assert.ok(spark);
  assert.ok(spark.line.startsWith("M0.00,"));
  assert.ok(spark.area.endsWith("Z"));
  const ys = [...spark.line.matchAll(/,(-?\d+\.\d+)/g)].map((m) => Number(m[1]));
  assert.ok(Math.min(...ys) >= 0 && Math.max(...ys) <= 40);
  // A flat series has no range to scale into; it must not divide by zero.
  const flat = sparklineGeometry([5, 5, 5], 100, 40);
  assert.ok(flat);
  assert.ok(flat.line.includes("20.00"));
  // Too little data is no line at all, not a degenerate one.
  assert.equal(sparklineGeometry([5], 100, 40), null);
});

test("every currency resolves to a mark, and metals never claim a flag", () => {
  const usd = currencyMark("USD");
  assert.equal(usd.kind, "flag");
  assert.equal(usd.kind === "flag" && usd.src, "/flags/us.svg");
  assert.equal(currencyMark("EUR").kind, "flag");
  const gold = currencyMark("XAU");
  assert.equal(gold.kind, "metal");
  assert.equal(gold.kind === "metal" && gold.short, "Au");
  // An unlisted currency still renders — as itself.
  assert.equal(currencyMark("ZZZ").kind, "unknown");
});

test("every mapped currency has its artwork on disk", () => {
  // A mapping without a file is a broken image on a card — catch it here, not
  // in the browser.
  for (const currency of FLAGGED_CURRENCIES) {
    const mark = currencyMark(currency);
    assert.equal(mark.kind, "flag");
    if (mark.kind !== "flag") continue;
    assert.ok(
      existsSync(resolve(process.cwd(), "public", mark.src.replace(/^\//, ""))),
      `missing flag artwork for ${currency} (${mark.src})`,
    );
  }
});

test("pairs split into both sides, broker suffixes and all", () => {
  const eurusd = pairMarks("EURUSD");
  assert.equal(eurusd.base.code, "EUR");
  assert.equal(eurusd.quote?.code, "USD");
  const gold = pairMarks("XAUUSDm");
  assert.equal(gold.base.kind, "metal");
  assert.equal(gold.quote?.code, "USD");
});
