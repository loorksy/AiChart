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

    const friday = Date.UTC(2026, 6, 17, 21, 45);
    const sundayOpen = Date.UTC(2026, 6, 19, 22, 0);
    assert.deepEqual(
      detectCandleGaps("EURUSD", "15m", [
        { time: friday },
        { time: sundayOpen },
      ]),
      [],
    );
  });
});
