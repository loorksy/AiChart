import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  detectCandleGaps,
  sanitizeCandles,
} from "@/lib/candles/candleRepository";

function candle(time: number, index = 0) {
  const open = 1.1 + index * 0.0001;
  return {
    time,
    open,
    high: open + 0.0005,
    low: open - 0.0005,
    close: open + 0.0002,
    volume: 100,
    complete: true,
  };
}

describe("candle data quality", () => {
  it("rejects malformed OHLC, duplicate timestamps, and isolated bad-tick wicks", () => {
    const start = Date.UTC(2026, 6, 20, 10, 0);
    const normal = Array.from({ length: 12 }, (_, index) =>
      candle(start + index * 60_000, index),
    );
    const result = sanitizeCandles([
      ...normal,
      { ...normal[3]!, close: normal[3]!.close + 0.0001 },
      { ...candle(start + 20 * 60_000), high: 1.0, low: 1.2 },
      {
        ...candle(start + 21 * 60_000),
        high: 1.2,
        low: 1.0995,
        open: 1.1,
        close: 1.1001,
      },
    ]);
    assert.equal(result.candles.length, 12);
    assert.equal(result.rejected, 3);
    assert.equal(
      result.candles.find((item) => item.time === normal[3]!.time)?.close,
      normal[3]!.close + 0.0001,
      "latest duplicate replaces the earlier bar",
    );
  });

  it("reports open-market holes but ignores the normal FX weekend", () => {
    const monday = Date.UTC(2026, 6, 20, 10, 0);
    const weekday = detectCandleGaps("EURUSD", "15m", [
      { time: monday },
      { time: monday + 15 * 60_000 },
      { time: monday + 45 * 60_000 },
    ]);
    assert.deepEqual(weekday, [
      {
        fromMs: monday + 30 * 60_000,
        toMs: monday + 30 * 60_000,
        missingBars: 1,
      },
    ]);

    // July = EDT: the FX week closes Friday 21:00 UTC (17:00 NY) and reopens
    // Sunday 21:00 UTC. The old fixture used fixed 22:00-UTC boundaries — the
    // exact DST bug the trading calendar fixed.
    const friday = Date.UTC(2026, 6, 17, 20, 45);
    const sundayOpen = Date.UTC(2026, 6, 19, 21, 0);
    assert.deepEqual(
      detectCandleGaps("EURUSD", "15m", [
        { time: friday },
        { time: sundayOpen },
      ]),
      [],
    );

    // January = EST: close/open land on 22:00 UTC.
    const fridayWinter = Date.UTC(2026, 0, 23, 21, 45);
    const sundayOpenWinter = Date.UTC(2026, 0, 25, 22, 0);
    assert.deepEqual(
      detectCandleGaps("EURUSD", "15m", [
        { time: fridayWinter },
        { time: sundayOpenWinter },
      ]),
      [],
    );
  });

  it("ignores the gold daily maintenance break instead of reporting phantom gaps", () => {
    // Tuesday 2026-07-21 (EDT): gold halts 21:00–22:00 UTC (17:00–18:00 NY).
    const lastBeforeBreak = Date.UTC(2026, 6, 21, 20, 45);
    const firstAfterBreak = Date.UTC(2026, 6, 21, 22, 0);
    assert.deepEqual(
      detectCandleGaps("XAUUSD", "15m", [
        { time: lastBeforeBreak },
        { time: firstAfterBreak },
      ]),
      [],
    );
    // The same wall-clock hole on EURUSD IS a real gap (fx has no break).
    const fxGaps = detectCandleGaps("EURUSD", "15m", [
      { time: lastBeforeBreak },
      { time: firstAfterBreak },
    ]);
    assert.equal(fxGaps.length, 1);
    assert.equal(fxGaps[0]?.missingBars, 4);
  });

  it("expects five daily bars per week at the 17:00-NY alignment", () => {
    // Daily bars open 21:00 UTC in July (17:00 EDT), Sun–Thu. A clean week
    // must report no gaps even though the weekend spacing exceeds 24h.
    const dailyOpens = [
      Date.UTC(2026, 6, 19, 21, 0), // Sun
      Date.UTC(2026, 6, 20, 21, 0), // Mon
      Date.UTC(2026, 6, 21, 21, 0), // Tue
      Date.UTC(2026, 6, 22, 21, 0), // Wed
      Date.UTC(2026, 6, 23, 21, 0), // Thu
      Date.UTC(2026, 6, 26, 21, 0), // next Sun (weekend jump)
    ];
    assert.deepEqual(
      detectCandleGaps("XAUUSD", "1d", dailyOpens.map((time) => ({ time }))),
      [],
    );

    // A genuinely missing Wednesday bar IS reported.
    const withHole = dailyOpens.filter(
      (time) => time !== Date.UTC(2026, 6, 22, 21, 0),
    );
    const holes = detectCandleGaps(
      "XAUUSD",
      "1d",
      withHole.map((time) => ({ time })),
    );
    assert.equal(holes.length, 1);
    assert.equal(holes[0]?.missingBars, 1);
  });
});
