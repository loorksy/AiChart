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

  // Timestamps must END AT ROUGHLY NOW, not at a fixed point in 2023. The feed
  // now judges freshness, so a frozen fixture would be permanently stale and
  // the test would assert the wrong thing (it did: this fixture ended in 2023
  // and the old depth-only check happily called it sufficient).
  const HOUR = 60 * 60_000;
  const lastBar = Date.now() - HOUR;
  await upsertAnalysisCandles(SYMBOL, INTERVAL, makeCandles(100, lastBar - 99 * HOUR, HOUR, 1.25));

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

/**
 * Regression: the feed used to read `order: "asc"` with no range bound, i.e.
 * `ORDER BY time ASC LIMIT n` — the OLDEST n rows in the store. Because the
 * sufficiency check was depth-only, once the backfill service held more than
 * `limit` bars the feed locked onto the very beginning of history and never
 * pulled live again. Recommendations, stops and targets were then priced off
 * bars that got older every day, delivered to real users with no warning.
 * The store here deliberately holds MORE history than the request, which is
 * the exact condition that made the old code fail.
 */
test("fetchAnalysisCandleFeed: serves the NEWEST window when the store holds more history than requested", async () => {
  const dir = mkdtempSync(join(tmpdir(), "aichart-analysis-feed-window-"));
  process.env.DB_PATH = join(dir, "test.db");
  process.env.ENCRYPTION_KEY = "0".repeat(64);
  process.env.APP_SECRET = "test-secret";
  delete process.env.DATABASE_URL;
  delete process.env.OANDA_API_TOKEN;

  const db = await import("@/lib/db");
  await db.initDb();
  const { upsertAnalysisCandles } = await import("@/lib/candles/analysisCandleRepository");
  const { fetchAnalysisCandleFeed } = await import("@/lib/markets/analysisCandleFeed");

  const HOUR = 60 * 60_000;
  const lastBar = Date.now() - HOUR;
  const total = 800;
  const rows = makeCandles(total, lastBar - (total - 1) * HOUR, HOUR, 1.25);
  await upsertAnalysisCandles("EURCHF", INTERVAL, rows);

  const fed = await fetchAnalysisCandleFeed("EURCHF", INTERVAL, 300);
  assert.equal(fed.candles.length, 300);

  const oldestReturned = fed.candles[0]!.time;
  const newestReturned = fed.candles[fed.candles.length - 1]!.time;
  assert.equal(newestReturned, rows[total - 1]!.time, "must end on the latest stored bar");
  assert.equal(oldestReturned, rows[total - 300]!.time, "must be the last 300 bars, not the first 300");
  assert.ok(oldestReturned > rows[0]!.time, "must not start at the beginning of history");
  assert.equal(fed.warning, undefined, "a fresh tail carries no staleness warning");
});

/**
 * Regression: a stale series must never be handed back silently. With no live
 * source configured the feed cannot refresh, so the only honest option is to
 * return what it has AND say how far behind it is.
 */
test("fetchAnalysisCandleFeed: warns when the newest stored bar is far in the past", async () => {
  const dir = mkdtempSync(join(tmpdir(), "aichart-analysis-feed-stale-"));
  process.env.DB_PATH = join(dir, "test.db");
  process.env.ENCRYPTION_KEY = "0".repeat(64);
  process.env.APP_SECRET = "test-secret";
  delete process.env.DATABASE_URL;
  delete process.env.OANDA_API_TOKEN;

  const db = await import("@/lib/db");
  await db.initDb();
  const { upsertAnalysisCandles } = await import("@/lib/candles/analysisCandleRepository");
  const { fetchAnalysisCandleFeed } = await import("@/lib/markets/analysisCandleFeed");

  const HOUR = 60 * 60_000;
  const lastBar = Date.now() - 45 * 24 * HOUR; // 45 days behind
  await upsertAnalysisCandles("AUDNZD", INTERVAL, makeCandles(100, lastBar - 99 * HOUR, HOUR, 1.25));

  const fed = await fetchAnalysisCandleFeed("AUDNZD", INTERVAL, 100);
  assert.equal(fed.candles.length, 100);
  assert.ok(fed.warning, "a stale tail must be reported, not served silently");
  assert.doesNotMatch(fed.warning!.toLowerCase(), /oanda/);
});

/**
 * Regression: `ANALYSIS_SOURCE` must not be the bare `"oanda"`. The retired
 * platform feed wrote ~445k rows under that label and they are still in the
 * production table (retention only prunes `metaapi`). Reusing it would make a
 * different provider's abandoned bars indistinguishable from this feed's own.
 */
test("fetchAnalysisCandleFeed: legacy source='oanda' rows are invisible to the analysis feed", async () => {
  const dir = mkdtempSync(join(tmpdir(), "aichart-analysis-feed-legacy-"));
  process.env.DB_PATH = join(dir, "test.db");
  process.env.ENCRYPTION_KEY = "0".repeat(64);
  process.env.APP_SECRET = "test-secret";
  delete process.env.DATABASE_URL;
  delete process.env.OANDA_API_TOKEN;

  const db = await import("@/lib/db");
  await db.initDb();
  const { fetchAnalysisCandleFeed } = await import("@/lib/markets/analysisCandleFeed");
  const { ANALYSIS_SOURCE } = await import("@/lib/candles/analysisCandleRepository");

  assert.notEqual(ANALYSIS_SOURCE, "oanda");

  // Write retired-feed rows directly under the OLD label, as production has.
  const HOUR = 60 * 60_000;
  const lastBar = Date.now() - HOUR;
  const legacy = makeCandles(200, lastBar - 199 * HOUR, HOUR, 9.99);
  for (const c of legacy) {
    await db.execute(
      `INSERT INTO market_candles (symbol, interval, time, open, high, low, close, volume, source, complete)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'oanda', 1)`,
      ["NZDCAD", INTERVAL, c.time, c.open, c.high, c.low, c.close, c.volume],
    );
  }

  const fed = await fetchAnalysisCandleFeed("NZDCAD", INTERVAL, 100);
  assert.equal(fed.candles.length, 0, "retired-feed rows must not be adopted as analysis data");
  assert.ok(fed.warning);
});
