import assert from "node:assert/strict";
import test, { afterEach } from "node:test";

import type { StoredCandle } from "@/lib/candles/candleRepository";

import {
  buildAiChartCandleWarehouseEnvelope,
  exportAiChartCandleWarehouse,
  ResearchServiceError,
} from "../index";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

const exportedAt = new Date("2025-01-06T11:00:00.000Z");

function candle(time: string, overrides: Partial<StoredCandle> = {}): StoredCandle {
  return {
    time: new Date(time).getTime(),
    open: 1.1,
    high: 1.2,
    low: 1.0,
    close: 1.15,
    volume: 100,
    complete: true,
    ...overrides,
  };
}

test("warehouse export matches the strict versioned Research Service envelope", () => {
  const result = buildAiChartCandleWarehouseEnvelope(
    { symbol: "eur/usd", timeframe: "1h", limit: 3 },
    [
      candle("2025-01-06T09:00:00Z"),
      candle("2025-01-06T10:00:00Z", { complete: false }),
    ],
    exportedAt,
  );
  assert.deepEqual(result, {
    schema_version: "aichart-candle-warehouse-v1",
    source: "aichart_candle_warehouse",
    exported_at: "2025-01-06T11:00:00.000Z",
    closed_bars_only: true,
    bars: [
      {
        timestamp: "2025-01-06T09:00:00.000Z",
        open: 1.1,
        high: 1.2,
        low: 1.0,
        close: 1.15,
        volume: 100,
        spread: null,
        symbol: "EURUSD",
        timeframe: "1h",
        source: "aichart_candle_warehouse",
        is_closed: true,
        timezone: "UTC",
      },
    ],
  });
  assert.doesNotMatch(JSON.stringify(result), /(?:url|path)/i);
});

test("warehouse export rejects empty-closed, false-complete, malformed and unordered data", () => {
  assert.throws(
    () =>
      buildAiChartCandleWarehouseEnvelope(
        { symbol: "EURUSD", timeframe: "1h" },
        [candle("2025-01-06T10:00:00Z", { complete: false })],
        exportedAt,
      ),
    /no closed candles/,
  );
  assert.throws(
    () =>
      buildAiChartCandleWarehouseEnvelope(
        { symbol: "EURUSD", timeframe: "1h" },
        [candle("2025-01-06T10:30:00Z")],
        exportedAt,
      ),
    /unfinished candle/,
  );
  assert.throws(
    () =>
      buildAiChartCandleWarehouseEnvelope(
        { symbol: "EURUSD", timeframe: "1h" },
        [candle("2025-01-06T09:00:00Z", { high: 1.05 })],
        exportedAt,
      ),
    /OHLC/,
  );
  assert.throws(
    () =>
      buildAiChartCandleWarehouseEnvelope(
        { symbol: "EURUSD", timeframe: "1h" },
        [candle("2025-01-06T09:00:00Z"), candle("2025-01-06T08:00:00Z")],
        exportedAt,
      ),
    /unordered/,
  );
});

test("warehouse export rejects unsupported symbols, intervals and unbounded ranges", () => {
  assert.throws(
    () =>
      buildAiChartCandleWarehouseEnvelope(
        { symbol: "US30", timeframe: "1h" },
        [candle("2025-01-06T09:00:00Z")],
        exportedAt,
      ),
    /symbol is unsupported/,
  );
  assert.throws(
    () =>
      buildAiChartCandleWarehouseEnvelope(
        { symbol: "EURUSD", timeframe: "2m" as "1m" },
        [candle("2025-01-06T09:00:00Z")],
        exportedAt,
      ),
    /timeframe is unsupported/,
  );
  assert.throws(
    () =>
      buildAiChartCandleWarehouseEnvelope(
        {
          symbol: "EURUSD",
          timeframe: "1h",
          fromMs: new Date("2000-01-01T00:00:00Z").getTime(),
          toMs: new Date("2025-01-01T00:00:00Z").getTime(),
        },
        [candle("2025-01-06T09:00:00Z")],
        exportedAt,
      ),
    /range exceeds/,
  );
});

test("disabled warehouse helper fails before loading the Candle Warehouse", async () => {
  delete process.env.RESEARCH_SERVICE_ENABLED;
  delete process.env.RESEARCH_BACKTEST_ENABLED;
  await assert.rejects(
    exportAiChartCandleWarehouse({ symbol: "EURUSD", timeframe: "1h" }),
    (error: unknown) =>
      error instanceof ResearchServiceError && error.code === "RESEARCH_SERVICE_DISABLED",
  );
});

test("warehouse helper source uses the bounded internal repository and no fetch or URL", async () => {
  const fs = await import("node:fs/promises");
  const source = await fs.readFile(new URL("../warehouse.ts", import.meta.url), "utf8");
  assert.match(source, /getCandles/);
  assert.doesNotMatch(source, /fetch\s*\(/);
  assert.doesNotMatch(source, /https?:\/\//);
  assert.doesNotMatch(source, /(?:from|to).*Path/);
});
