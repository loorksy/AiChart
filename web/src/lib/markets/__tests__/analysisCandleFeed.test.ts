import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const SYMBOL = "GBPUSD";
const INTERVAL = "1h";

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
 * `fetchAnalysisCandleFeed` is the "warehouse, then live" primitive shared by
 * `fetchQuantAgentAnalysisBars` (plan §4) and the five analysis-only MCP
 * bridge routes (plan §5) — one implementation, so both build on identical
 * behavior. `OANDA_API_TOKEN` is deliberately left unset so no live HTTP
 * call is ever attempted.
 */
test("fetchAnalysisCandleFeed: sufficient warehouse coverage is served straight from the DB", async () => {
  const dir = mkdtempSync(join(tmpdir(), "aichart-analysis-feed-"));
  process.env.DB_PATH = join(dir, "test.db");
  process.env.ENCRYPTION_KEY = "0".repeat(64);
  process.env.APP_SECRET = "test-secret";
  delete process.env.DATABASE_URL;
  delete process.env.OANDA_API_TOKEN;

  const db = await import("@/lib/db");
  await db.initDb();
  const { upsertAnalysisCandles } = await import("@/lib/candles/analysisCandleRepository");
  const { fetchAnalysisCandleFeed, ANALYSIS_BOOK_LABEL } = await import("@/lib/markets/analysisCandleFeed");

  await upsertAnalysisCandles(SYMBOL, INTERVAL, makeCandles(100, 1_700_000_000_000, 60 * 60_000, 1.25));

  const fed = await fetchAnalysisCandleFeed(SYMBOL, INTERVAL, 100);
  assert.equal(fed.symbol, SYMBOL);
  assert.equal(fed.interval, INTERVAL);
  assert.equal(fed.candles.length, 100);
  assert.equal(fed.warning, undefined);
  // The neutral book label must never be the literal provider name.
  assert.equal(ANALYSIS_BOOK_LABEL, "reference_feed");
  assert.doesNotMatch(ANALYSIS_BOOK_LABEL.toLowerCase(), /oanda/);
});

test("fetchAnalysisCandleFeed: empty warehouse + no configured live source returns an honest empty series with a warning", async () => {
  const dir = mkdtempSync(join(tmpdir(), "aichart-analysis-feed-empty-"));
  process.env.DB_PATH = join(dir, "test.db");
  process.env.ENCRYPTION_KEY = "0".repeat(64);
  process.env.APP_SECRET = "test-secret";
  delete process.env.DATABASE_URL;
  delete process.env.OANDA_API_TOKEN;

  const db = await import("@/lib/db");
  await db.initDb();
  const { fetchAnalysisCandleFeed } = await import("@/lib/markets/analysisCandleFeed");

  const fed = await fetchAnalysisCandleFeed("USDJPY", "4h", 50);
  assert.equal(fed.candles.length, 0);
  assert.ok(fed.warning);
  // Never leak the literal provider name into a caller-visible warning string.
  assert.doesNotMatch(fed.warning!.toLowerCase(), /oanda/);
});
