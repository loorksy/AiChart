import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const SYMBOL = "EURUSD";
const INTERVAL = "15m";

function makeCandles(n: number, startMs: number, stepMs: number) {
  return Array.from({ length: n }, (_, i) => ({
    time: startMs + i * stepMs,
    open: 1.1 + i * 0.0001,
    high: 1.1 + i * 0.0001 + 0.0005,
    low: 1.1 + i * 0.0001 - 0.0005,
    close: 1.1 + i * 0.0001 + 0.0002,
    volume: 100 + i,
    complete: true,
  }));
}

/**
 * Drives the real SQLite backend on a throwaway DB file (the db layer is a
 * module singleton, so all assertions share one setup). Validates the warehouse
 * repository upsert/read/coverage + the ON CONFLICT idempotency path.
 */
test("candle warehouse repository (sqlite)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "aichart-warehouse-"));
  process.env.DB_PATH = join(dir, "test.db");
  process.env.ENCRYPTION_KEY = "0".repeat(64);
  process.env.APP_SECRET = "test-secret";
  delete process.env.DATABASE_URL;

  const db = await import("@/lib/db");
  await db.initDb();
  const { upsertCandles, getCandles, getCoverage } = await import(
    "@/lib/candles/candleRepository"
  );

  // Upsert 50 candles, read back ascending.
  const rows = makeCandles(50, 1_700_000_000_000, 15 * 60_000);
  const written = await upsertCandles(SYMBOL, INTERVAL, rows);
  assert.equal(written, 50);

  const read = await getCandles({ symbol: SYMBOL, interval: INTERVAL, limit: 100 });
  assert.equal(read.length, 50);
  for (let i = 1; i < read.length; i++) {
    assert.ok(read[i]!.time > read[i - 1]!.time, "ascending by time");
  }

  // Re-upsert same window with changed close → ON CONFLICT update, no dupes.
  const mutated = rows.map((r) => ({ ...r, close: r.close + 0.01 }));
  await upsertCandles(SYMBOL, INTERVAL, mutated);
  const cov = await getCoverage({ symbol: SYMBOL, interval: INTERVAL });
  assert.equal(cov.count, 50, "no duplicate rows after re-upsert");

  // Window bounds honored.
  const mid = cov.firstTime! + (cov.lastTime! - cov.firstTime!) / 2;
  const windowed = await getCandles({
    symbol: SYMBOL,
    interval: INTERVAL,
    fromMs: mid,
    limit: 100,
  });
  assert.ok(windowed.every((c) => c.time >= mid), "respects fromMs bound");

  // Structurally invalid candles are dropped.
  const bad = [
    { time: 1, open: -1, high: 1, low: 1, close: 1 },
    { time: 2_000_000_000_000, open: 1, high: 1, low: 1, close: 1 },
  ];
  const w2 = await upsertCandles("GBPUSD", INTERVAL, bad);
  assert.equal(w2, 1, "negative-price candle dropped");
});
