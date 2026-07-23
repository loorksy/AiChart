import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mergeCandleGaps } from "../candleCompleteness";
import { CANDLE_RETENTION_MS } from "../candleRepository";
import { targetHistoryStartMs } from "../candleHistoryPolicy";

describe("candle completeness helpers", () => {
  it("retains a 5-year window for major timeframes including 1h", () => {
    const fiveYears = 5 * 365.25 * 24 * 60 * 60 * 1000;
    for (const interval of ["1m", "5m", "15m", "30m", "1h", "4h", "1d"]) {
      assert.ok(
        (CANDLE_RETENTION_MS[interval] ?? 0) >= fiveYears - 1,
        `${interval} should keep ~5 years`,
      );
    }
  });

  it("targets history start ~5 years back", () => {
    const now = Date.UTC(2026, 6, 23);
    const start = targetHistoryStartMs("1h", now);
    const days = (now - start) / 86_400_000;
    assert.ok(days > 1800 && days < 1900, `expected ~5y, got ${days} days`);
  });

  it("merges overlapping gap windows", () => {
    assert.deepEqual(
      mergeCandleGaps([
        { fromMs: 100, toMs: 200, missingBars: 2 },
        { fromMs: 150, toMs: 300, missingBars: 5 },
        { fromMs: 500, toMs: 600, missingBars: 1 },
      ]),
      [
        { fromMs: 100, toMs: 300, missingBars: 5 },
        { fromMs: 500, toMs: 600, missingBars: 1 },
      ],
    );
  });
});
