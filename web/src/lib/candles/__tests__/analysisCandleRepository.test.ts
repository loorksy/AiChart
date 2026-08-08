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
 * Same throwaway-sqlite pattern as `candleWarehouse.integration.test.ts`, but
 * proves the property this whole plan depends on: `source='metaapi'` (the
 * chart's/Lonora's rows) and `source='oanda'` (analysis-only rows) for the
 * EXACT SAME symbol/interval never cross, regardless of which function reads.
 */
test("analysis candle repository isolation (sqlite)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "aichart-analysis-warehouse-"));
  process.env.DB_PATH = join(dir, "test.db");
  process.env.ENCRYPTION_KEY = "0".repeat(64);
  process.env.APP_SECRET = "test-secret";
  delete process.env.DATABASE_URL;

  const db = await import("@/lib/db");
  await db.initDb();
  const { upsertCandles, getCandles, getCoverage } = await import("@/lib/candles/candleRepository");
  const {
    upsertAnalysisCandles,
    getAnalysisCandles,
    getAnalysisCoverage,
    countAnalysisCandlesInRange,
    ANALYSIS_SOURCE,
  } = await import("@/lib/candles/analysisCandleRepository");

  assert.equal(ANALYSIS_SOURCE, "oanda");

  // Write DIFFERENT prices under each source for the exact same symbol/interval/time window.
  const metaapiRows = makeCandles(30, 1_700_000_000_000, 15 * 60_000, 1.1);
  const oandaRows = makeCandles(30, 1_700_000_000_000, 15 * 60_000, 9.9); // deliberately distinguishable

  const writtenMetaapi = await upsertCandles(SYMBOL, INTERVAL, metaapiRows);
  const writtenOanda = await upsertAnalysisCandles(SYMBOL, INTERVAL, oandaRows);
  assert.equal(writtenMetaapi, 30);
  assert.equal(writtenOanda, 30);

  // Each source's reader sees ONLY its own 30 rows, at its own prices — never the other's.
  const metaapiRead = await getCandles({ symbol: SYMBOL, interval: INTERVAL, limit: 100 });
  const oandaRead = await getAnalysisCandles({ symbol: SYMBOL, interval: INTERVAL, limit: 100 });
  assert.equal(metaapiRead.length, 30);
  assert.equal(oandaRead.length, 30);
  assert.ok(metaapiRead.every((c) => c.open < 5), "metaapi reader only ever sees metaapi-priced rows");
  assert.ok(oandaRead.every((c) => c.open > 5), "analysis reader only ever sees oanda-priced rows");

  // Coverage counts are independent per source, same symbol/interval.
  const metaapiCoverage = await getCoverage({ symbol: SYMBOL, interval: INTERVAL });
  const oandaCoverage = await getAnalysisCoverage({ symbol: SYMBOL, interval: INTERVAL });
  assert.equal(metaapiCoverage.count, 30);
  assert.equal(oandaCoverage.count, 30);

  const oandaRangeCount = await countAnalysisCandlesInRange({
    symbol: SYMBOL,
    interval: INTERVAL,
    fromMs: 1_700_000_000_000,
    toMs: 1_700_000_000_000 + 29 * 15 * 60_000,
  });
  assert.equal(oandaRangeCount, 30);

  // Re-upserting one source never touches the other's row count (no ON CONFLICT bleed across sources).
  await upsertCandles(SYMBOL, INTERVAL, metaapiRows.map((r) => ({ ...r, close: r.close + 1 })));
  const oandaCoverageAfter = await getAnalysisCoverage({ symbol: SYMBOL, interval: INTERVAL });
  assert.equal(oandaCoverageAfter.count, 30, "writing metaapi rows must never affect oanda row count");
});
