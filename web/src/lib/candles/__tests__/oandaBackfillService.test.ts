import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";

const realFetch = globalThis.fetch;

afterEach(async () => {
  globalThis.fetch = realFetch;
  delete process.env.OANDA_API_TOKEN;
  delete process.env.CANDLE_HISTORY_YEARS;
  delete process.env.CANDLE_SYNC_MAX_PAGES;
  const { clearPlatformConfigCache } = await import("@/lib/platformConfig");
  clearPlatformConfigCache();
  const { __resetResilience } = await import("@/lib/providerResilience");
  __resetResilience();
});

function oandaCandlesResponse(n: number, endMs: number, stepMs: number, priceBase: number) {
  const candles = Array.from({ length: n }, (_, i) => {
    const t = endMs - (n - 1 - i) * stepMs;
    const o = priceBase + i * 0.0001;
    return {
      time: new Date(t).toISOString(),
      volume: 100 + i,
      complete: true,
      mid: {
        o: o.toFixed(5),
        h: (o + 0.0005).toFixed(5),
        l: (o - 0.0005).toFixed(5),
        c: (o + 0.0002).toFixed(5),
      },
    };
  });
  return { candles };
}

function mockOandaFetch(n: number, endMs: number, stepMs: number, priceBase: number): void {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(oandaCandlesResponse(n, endMs, stepMs, priceBase)), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;
}

async function setupDb(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "aichart-oanda-backfill-"));
  process.env.DB_PATH = join(dir, "test.db");
  process.env.ENCRYPTION_KEY = "0".repeat(64);
  process.env.APP_SECRET = "test-secret";
  delete process.env.DATABASE_URL;
  const db = await import("@/lib/db");
  await db.initDb();
}

test("backfillAnalysisCandles short-circuits with not_configured when no OANDA token is set (no network attempted)", async () => {
  await setupDb();
  delete process.env.OANDA_API_TOKEN;
  globalThis.fetch = (async () => {
    throw new Error("must not be called without a configured token");
  }) as typeof fetch;

  const { backfillAnalysisCandles, maintainAnalysisCandleSeries } = await import(
    "@/lib/candles/oandaBackfillService"
  );

  const result = await backfillAnalysisCandles({ symbol: "EURUSD", interval: "1d", limit: 10 });
  assert.deepEqual(result, { inserted: 0, skipped: true, reason: "not_configured" });

  const maintenance = await maintainAnalysisCandleSeries({ symbol: "EURUSD", interval: "1d" });
  assert.equal(maintenance.coverage.count, 0);
  assert.ok(
    maintenance.errors.some((e) => e.includes("not configured")),
    "maintenance surfaces the not-configured reason",
  );
});

test("triggerAnalysisBackfill is fire-and-forget and never throws synchronously", async () => {
  await setupDb();
  delete process.env.OANDA_API_TOKEN;
  const { triggerAnalysisBackfill } = await import("@/lib/candles/oandaBackfillService");
  assert.doesNotThrow(() => triggerAnalysisBackfill({ symbol: "EURUSD", interval: "1d" }));
});

test("backfillAnalysisCandles writes OANDA candles into the analysis-only store (source='oanda') when configured", async () => {
  await setupDb();
  process.env.OANDA_API_TOKEN = "test-oanda-token";
  const now = Date.now();
  const step = 24 * 60 * 60_000;
  mockOandaFetch(10, now - step, step, 1.1);

  const { backfillAnalysisCandles } = await import("@/lib/candles/oandaBackfillService");
  const { getAnalysisCoverage } = await import("@/lib/candles/analysisCandleRepository");

  const result = await backfillAnalysisCandles({
    symbol: "EURUSD",
    interval: "1d",
    fromMs: now - 11 * step,
    toMs: now - step,
    limit: 10,
  });
  assert.equal(result.skipped, false);
  assert.equal(result.inserted, 10);

  const coverage = await getAnalysisCoverage({ symbol: "EURUSD", interval: "1d" });
  assert.equal(coverage.count, 10);
});

test("maintainAnalysisCandleSeries runs end-to-end (latest + bounded historical page + gap repair) without throwing", async () => {
  await setupDb();
  process.env.OANDA_API_TOKEN = "test-oanda-token";
  process.env.CANDLE_HISTORY_YEARS = "1";
  process.env.CANDLE_SYNC_MAX_PAGES = "1";
  const now = Date.now();
  const step = 24 * 60 * 60_000;
  mockOandaFetch(15, now - step, step, 1.2);

  const { maintainAnalysisCandleSeries } = await import("@/lib/candles/oandaBackfillService");
  const result = await maintainAnalysisCandleSeries({ symbol: "GBPUSD", interval: "1d" });

  assert.equal(result.symbol, "GBPUSD");
  assert.equal(result.interval, "1d");
  assert.ok(result.coverage.count > 0, "some rows landed under source='oanda'");
  assert.ok(
    !result.errors.some((e) => e.includes("not configured")),
    "a configured token must not report not_configured",
  );
});
