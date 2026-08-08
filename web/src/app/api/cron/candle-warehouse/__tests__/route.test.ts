/**
 * The cron used to early-return before even acquiring the maintenance lock
 * when zero MT accounts were linked anywhere on the platform, which also
 * silently starved the OANDA analysis-only phase — a platform-level
 * credential with nothing to do with any linked MetaTrader account. This
 * proves the restructuring: the MT phase alone reports
 * `skipped: "no_feeder_account"`, while the independent OANDA phase still
 * runs (gated only on `oandaConfigured()`), in the SAME route/lock.
 */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { NextRequest } from "next/server";

const realFetch = globalThis.fetch;
const CRON_SECRET = "route-test-cron-secret";

afterEach(async () => {
  globalThis.fetch = realFetch;
  delete process.env.OANDA_API_TOKEN;
  delete process.env.CANDLE_SYNC_SYMBOLS;
  delete process.env.CANDLE_SYNC_INTERVALS;
  delete process.env.CANDLE_SYNC_MAX_SERIES;
  delete process.env.CANDLE_HISTORY_YEARS;
  delete process.env.CANDLE_SYNC_MAX_PAGES;
  const { clearPlatformConfigCache } = await import("@/lib/platformConfig");
  clearPlatformConfigCache();
  const { __resetResilience } = await import("@/lib/providerResilience");
  __resetResilience();
});

async function setupDb(dbName: string): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), `aichart-cron-candle-warehouse-${dbName}-`));
  process.env.DB_PATH = join(dir, "test.db");
  process.env.ENCRYPTION_KEY = "0".repeat(64);
  process.env.APP_SECRET = "test-secret";
  process.env.CRON_SECRET = CRON_SECRET;
  delete process.env.DATABASE_URL;
  const db = await import("@/lib/db");
  await db.initDb();
  const { clearPlatformConfigCache } = await import("@/lib/platformConfig");
  clearPlatformConfigCache();
}

function postRequest(): NextRequest {
  return new NextRequest("http://localhost/api/cron/candle-warehouse", {
    method: "POST",
    headers: { authorization: `Bearer ${CRON_SECRET}` },
  });
}

function mockOandaFetch(n: number, endMs: number, stepMs: number, priceBase: number): void {
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
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ candles }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;
}

test("with zero linked MT accounts and OANDA unconfigured, both phases skip quietly (not a hard failure)", async () => {
  await setupDb("both-skip");
  delete process.env.OANDA_API_TOKEN;

  const { POST } = await import("../route");
  const res = await POST(postRequest());
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.equal(body.ok, true);
  assert.deepEqual(body.mt, { skipped: "no_feeder_account" });
  assert.deepEqual(body.oanda, { skipped: "oanda_not_configured" });
});

test("the OANDA phase runs independently of the MT feeder guard — zero MT accounts, OANDA configured", async () => {
  await setupDb("oanda-independent");
  process.env.OANDA_API_TOKEN = "test-oanda-token";
  process.env.CANDLE_SYNC_SYMBOLS = "EURUSD";
  process.env.CANDLE_SYNC_INTERVALS = "1d";
  process.env.CANDLE_SYNC_MAX_SERIES = "1";
  process.env.CANDLE_HISTORY_YEARS = "1";
  process.env.CANDLE_SYNC_MAX_PAGES = "1";
  const now = Date.now();
  const step = 24 * 60 * 60_000;
  mockOandaFetch(10, now - step, step, 1.15);

  const { POST } = await import("../route");
  const res = await POST(postRequest());
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.equal(body.ok, true);
  // The MT phase still honestly reports no feeder account anywhere...
  assert.deepEqual(body.mt, { skipped: "no_feeder_account" });
  // ...but the OANDA phase was NOT blocked by that guard: it processed the
  // configured series on its own, platform-level credential.
  assert.equal(body.oanda.skipped, undefined);
  assert.equal(body.oanda.processed, 1);
  assert.equal(body.oanda.results.length, 1);
  assert.equal(body.oanda.results[0].symbol, "EURUSD");
  assert.ok(body.oanda.results[0].coverage.count > 0);
});

test("rejects requests without a valid cron secret", async () => {
  await setupDb("auth");
  const { POST } = await import("../route");
  const res = await POST(
    new NextRequest("http://localhost/api/cron/candle-warehouse", { method: "POST" }),
  );
  assert.equal(res.status, 401);
});
