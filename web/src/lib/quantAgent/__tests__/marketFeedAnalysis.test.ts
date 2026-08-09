import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const SYMBOL = "EURUSD";
const INTERVAL = "15m";

function makeCandles(n: number, startMs: number, stepMs: number, priceBase: number) {
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
 * `fetchQuantAgentAnalysisBars` (plan §4) takes NO userId at all — this is
 * the whole point of the cron decoupling. Uses the same throwaway-sqlite
 * pattern as `analysisCandleRepository.test.ts`. `OANDA_API_TOKEN` is
 * deliberately left unset so `oandaConfigured()` is false and no live HTTP
 * call is ever attempted — a "thin coverage" scenario surfaces as a warning
 * (never a thrown error, never invented candles), and a "warehouse has
 * enough rows already" scenario is served entirely from the DB.
 */
test("fetchQuantAgentAnalysisBars: warehouse-sufficient read needs no userId and no live call", async () => {
  const dir = mkdtempSync(join(tmpdir(), "aichart-quant-analysis-"));
  process.env.DB_PATH = join(dir, "test.db");
  process.env.ENCRYPTION_KEY = "0".repeat(64);
  process.env.APP_SECRET = "test-secret";
  delete process.env.DATABASE_URL;
  delete process.env.OANDA_API_TOKEN;

  const db = await import("@/lib/db");
  await db.initDb();
  const { upsertAnalysisCandles } = await import("@/lib/candles/analysisCandleRepository");
  const { fetchQuantAgentAnalysisBars } = await import("@/lib/quantAgent/marketFeed");

  // Timestamps must end at roughly NOW. The feed judges tail freshness, not
  // just row count, so a fixture frozen in 2023 is legitimately stale and
  // would come back carrying a staleness warning.
  const STEP = 15 * 60_000;
  const lastBar = Date.now() - STEP;
  const rows = makeCandles(50, lastBar - 49 * STEP, STEP, 1.1);
  await upsertAnalysisCandles(SYMBOL, INTERVAL, rows);

  // No `userId` field exists on the options type at all — this call
  // compiling is itself part of the "no per-user concept" guarantee.
  const result = await fetchQuantAgentAnalysisBars({ symbol: SYMBOL, interval: INTERVAL, limit: 50 });

  assert.equal(result.symbol, SYMBOL);
  assert.equal(result.interval, INTERVAL);
  assert.equal(result.bars.length, 50);
  assert.equal(result.warning, undefined, "sufficient warehouse coverage needs no warning");
  assert.ok(result.bars.every((b) => b.open > 1), "bars come from the warehouse rows just written");
});

test("fetchQuantAgentAnalysisBars: thin/absent coverage with no live source configured reports a warning, never invents bars", async () => {
  const dir = mkdtempSync(join(tmpdir(), "aichart-quant-analysis-thin-"));
  process.env.DB_PATH = join(dir, "test.db");
  process.env.ENCRYPTION_KEY = "0".repeat(64);
  process.env.APP_SECRET = "test-secret";
  delete process.env.DATABASE_URL;
  delete process.env.OANDA_API_TOKEN;

  const db = await import("@/lib/db");
  await db.initDb();
  const { fetchQuantAgentAnalysisBars } = await import("@/lib/quantAgent/marketFeed");

  const result = await fetchQuantAgentAnalysisBars({ symbol: "GBPUSD", interval: "1h", limit: 300 });

  assert.equal(result.bars.length, 0);
  assert.ok(result.warning, "empty analysis warehouse + no configured live source must surface a warning");
});

test("fetchQuantAgentAnalysisBars: rejects a non-forex market exactly like fetchQuantAgentBars does", async () => {
  const { fetchQuantAgentAnalysisBars, QuantAgentMarketFeedError } = await import(
    "@/lib/quantAgent/marketFeed"
  );
  await assert.rejects(
    () => fetchQuantAgentAnalysisBars({ symbol: "BTCUSD", market: "crypto" }),
    QuantAgentMarketFeedError,
  );
});
