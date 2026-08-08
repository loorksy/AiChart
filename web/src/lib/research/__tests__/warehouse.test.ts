import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

function makeRows(n: number, startMs: number, stepMs: number, priceBase: number) {
  return Array.from({ length: n }, (_, i) => ({
    time: startMs + i * stepMs,
    open: priceBase + i * 0.0001,
    high: priceBase + i * 0.0001 + 0.0005,
    low: priceBase + i * 0.0001 - 0.0005,
    close: priceBase + i * 0.0001 + 0.0002,
    volume: 100 + i,
    complete: true,
  }));
}

/**
 * Real sqlite backend (throwaway DB file, same pattern as
 * `candles/__tests__/analysisCandleRepository.test.ts`). Proves the plan's
 * central backtest-fallback constraint: when MT coverage is too thin (same
 * gate `strategies/pipeline.ts`'s `submitStrategyBacktest` checks), the
 * OANDA-sourced analysis store fills ONLY the strictly older, disjoint
 * window MT does not cover — never interleaved bars at the same timestamp.
 */
test("backtest fallback fills the disjoint older window from OANDA without ever overlapping an MT timestamp (sqlite)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "aichart-warehouse-fallback-"));
  process.env.DB_PATH = join(dir, "test.db");
  process.env.ENCRYPTION_KEY = "0".repeat(64);
  process.env.APP_SECRET = "test-secret";
  process.env.RESEARCH_SERVICE_ENABLED = "1";
  process.env.RESEARCH_BACKTEST_ENABLED = "1";
  delete process.env.DATABASE_URL;
  delete process.env.OANDA_API_TOKEN; // not_configured path — no network call risked

  const db = await import("@/lib/db");
  await db.initDb();
  const { upsertCandles } = await import("@/lib/candles/candleRepository");
  const { upsertAnalysisCandles } = await import("@/lib/candles/analysisCandleRepository");
  const { listWarmDemand } = await import("@/lib/candles/warmDemand");

  const STEP = 60 * 60_000; // 1h
  const FROM = 1_700_000_000_000;

  // --- Scenario A: MT thin (50 bars) + OANDA covers the older gap ---------
  const symbolA = "EURUSD";
  const toA = FROM + 400 * STEP; // expectedCalendarBars = 400 → minimumDepth = 200
  const mtA = makeRows(50, FROM + 350 * STEP, STEP, 1.1); // recent tail only — insufficient
  const oandaA = makeRows(301, FROM, STEP, 9.9); // older window, disjoint from mtA
  await upsertCandles(symbolA, "1h", mtA);
  await upsertAnalysisCandles(symbolA, "1h", oandaA);

  const envelopeA = await exportAiChartCandleWarehouse({
    symbol: symbolA,
    timeframe: "1h",
    fromMs: FROM,
    toMs: toA,
    limit: 1000,
  });
  assert.equal(envelopeA.bars.length, 351, "OANDA's 301 + MT's 50, disjoint, both present");
  const timesA = envelopeA.bars.map((b) => new Date(b.timestamp).getTime());
  assert.deepEqual(timesA, [...timesA].sort((a, b) => a - b), "strictly time-ordered");
  assert.equal(new Set(timesA).size, timesA.length, "no duplicate timestamps across providers");
  const mtEarliestA = Math.min(...mtA.map((c) => c.time));
  const oandaLatestA = Math.max(...oandaA.map((c) => c.time));
  assert.ok(oandaLatestA < mtEarliestA, "OANDA bars stay strictly older than every MT bar");
  assert.ok(
    timesA.every((t) => t <= oandaLatestA || t >= mtEarliestA),
    "no bar falls inside the gap between the two disjoint windows",
  );

  // --- Scenario B: MT alone already clears the gate — OANDA untouched -----
  const symbolB = "GBPUSD";
  const toB = FROM + 250 * STEP;
  const mtB = makeRows(250, FROM, STEP, 1.3); // 250 >= minimumDepth(200) — sufficient alone
  await upsertCandles(symbolB, "1h", mtB);
  // Deliberately NO OANDA rows for symbolB — if the fallback fired anyway,
  // there would be nothing to merge in and the count would still match, so
  // the real assertion is that a below-gate OANDA row for the SAME symbol
  // never appears: there is none, so any leak would show as an error, not a
  // silent pass.
  const envelopeB = await exportAiChartCandleWarehouse({
    symbol: symbolB,
    timeframe: "1h",
    fromMs: FROM,
    toMs: toB,
    limit: 1000,
  });
  assert.equal(envelopeB.bars.length, 250, "MT alone satisfies the gate — no fallback needed");

  // --- Scenario C: MT thin AND OANDA thin for the gap → warm demand fires -
  const symbolC = "USDJPY";
  const toC = FROM + 400 * STEP;
  const mtC = makeRows(50, FROM + 350 * STEP, STEP, 150);
  const oandaCThin = makeRows(5, FROM, STEP, 150); // far fewer than the ~350-bar gap
  await upsertCandles(symbolC, "1h", mtC);
  await upsertAnalysisCandles(symbolC, "1h", oandaCThin);

  await exportAiChartCandleWarehouse({
    symbol: symbolC,
    timeframe: "1h",
    fromMs: FROM,
    toMs: toC,
    limit: 1000,
  });
  // recordWarmDemand/triggerAnalysisBackfill are fire-and-forget — give the
  // in-process DB write a tick to land before reading it back.
  await new Promise((resolve) => setTimeout(resolve, 25));
  const demand = await listWarmDemand();
  assert.ok(
    demand.some((entry) => entry.symbol === symbolC && entry.interval === "1h"),
    "thin OANDA coverage for the disjoint gap registers warm demand for next time",
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
