import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import { normalizeDemand } from "@/lib/candles/warmDemand";

const NOW = 1_770_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

test("keeps the newest request per series and orders by recency", () => {
  const list = normalizeDemand(
    [
      { symbol: "EURUSD", interval: "5m", at: NOW - 3 * DAY },
      { symbol: "XAUUSD", interval: "1m", at: NOW - 1 * DAY },
      { symbol: "EURUSD", interval: "5m", at: NOW - 2 * DAY },
    ],
    NOW,
  );
  assert.deepEqual(
    list.map((entry) => `${entry.symbol}|${entry.interval}`),
    ["XAUUSD|1m", "EURUSD|5m"],
  );
  // The surviving EURUSD entry is the more recent of the two.
  assert.equal(list[1]!.at, NOW - 2 * DAY);
});

test("a series nobody has asked for in two weeks stops being warmed", () => {
  const list = normalizeDemand(
    [
      { symbol: "GBPJPY", interval: "1h", at: NOW - 15 * DAY },
      { symbol: "EURUSD", interval: "1h", at: NOW - 13 * DAY },
    ],
    NOW,
  );
  assert.deepEqual(list.map((entry) => entry.symbol), ["EURUSD"]);
});

test("the list stays bounded so the flag cannot grow without limit", () => {
  const many = Array.from({ length: 500 }, (_, index) => ({
    symbol: `SYM${index}`,
    interval: "5m",
    at: NOW - index,
  }));
  const list = normalizeDemand(many, NOW);
  assert.ok(list.length <= 60, `expected a cap, got ${list.length}`);
  // Newest survive, oldest are dropped.
  assert.equal(list[0]!.symbol, "SYM0");
});

/**
 * The cold-start pull used to page as deep as the range fetcher allowed — up to
 * ten pages at twelve seconds each — while the operator waited behind a
 * market-data deadline of ten seconds. It could not deliver in time, so it only
 * ever failed slowly, and the abandoned pages kept running afterwards.
 *
 * These read the source because the behaviour they protect is a call argument,
 * not a return value: the alternative is a live broker pull in a unit test.
 */
test("the request path caps its own backfill and registers the series", () => {
  const source = readFileSync(
    resolve(process.cwd(), "src/lib/candles/warehouseOhlc.ts"),
    "utf8",
  );
  const capped = source.match(/maxPages: 1/g) ?? [];
  assert.equal(capped.length, 2, "both cold paths (range and latest-N) must cap");
  const recorded = source.match(/recordWarmDemand\(/g) ?? [];
  assert.equal(recorded.length, 2, "both cold paths must register demand");
});

/**
 * The first pass at this bounded the two paths in warehouseOhlc and missed the
 * one that was actually failing. buildAgentMarketContext calls backfillCandles
 * directly — three in parallel, for the current timeframe, the higher one and
 * the daily — inside the market-data stage deadline. The daily series is the
 * least likely to be warm, so it paged deep and took the whole analysis down
 * with it. A live run on XAUUSDM 15m failed exactly this way. Thin-but-nonempty
 * series must deepen off the critical path so coverage can report honestly
 * without killing the run.
 */
test("the market-context refill caps its pages too", () => {
  const source = readFileSync(
    resolve(process.cwd(), "src/lib/agent/marketContext/buildAgentMarketContext.ts"),
    "utf8",
  );
  assert.match(source, /maxPages: 1/);
  assert.match(source, /recordWarmDemand\(/);
  // Non-empty thin series must not await MetaApi inside the stage.
  assert.match(source, /available > 0/);
  assert.match(source, /void backfillCandles\(/);
});

/**
 * Second live failure (request 3702237f, five minutes after a pm2 restart)
 * exposed the deepest layer: getFreshAgentCandles blocked on a live MetaApi
 * pull — two attempts, skipCache — BEFORE reading the warehouse. The
 * connection cache is per-process, so the first analysis after every deploy
 * paid RPC session establishment (tens of seconds) against a stage deadline
 * that used to be only ten seconds. The 28ms warehouse read was never reached.
 */
test("fresh candles serve the warehouse first when its tail is fresh", () => {
  const source = readFileSync(
    resolve(process.cwd(), "src/lib/agent/marketContext/getFreshAgentCandles.ts"),
    "utf8",
  );
  // The warehouse read must come before the last-resort unbounded live pull.
  // (The sentinel used to be the two-attempt retry loop "for (let attempt";
  // that loop was replaced by a single awaited pullLive() at the tail — the
  // fallback for an EMPTY warehouse — and the stale sentinel made this test
  // fail while the guarantee it protects still held.)
  const warehouseFirst = source.indexOf("FEATURES.boundedColdStartV1()");
  const blockingLive = source.indexOf("liveCandles = await pullLive()");
  assert.ok(
    warehouseFirst >= 0 && warehouseFirst < blockingLive,
    "warehouse-first gate must precede the last-resort blocking live pull",
  );
  // ...a FRESH tail refreshes off the critical path...
  assert.match(source, /void pullLive\(\)/);
  // ...a STALE tail on an open market may wait for live data, but only behind
  // an explicit time budget (Promise.race against a timeout) so cold MetaApi
  // connects can never eat the whole market-data deadline...
  assert.match(source, /AGENT_LIVE_RESCUE_TIMEOUT_MS/);
  assert.match(source, /Promise\.race\(\[pull, timeout\]\)/);
  // ...and freshness is judged, not assumed.
  assert.match(source, /candleFreshnessToleranceMs\(interval\)/);
});

test("the fault card names the stage the envelope already carries", () => {
  const source = readFileSync(
    resolve(process.cwd(), "src/components/agent/AgentEnvelopeStatus.tsx"),
    "utf8",
  );
  // Deriving the sentence from failure_code alone discarded a cause the server
  // had already identified and written to the audit row.
  assert.match(source, /envelope\.degraded_stages/);
  assert.match(source, /envelope\.failure_stage/);
  assert.match(source, /userMessageForFailure\([\s\S]{0,120}stages,/);
});

test("the cron warms recorded demand, not just its configured list", () => {
  const source = readFileSync(
    resolve(process.cwd(), "src/app/api/cron/candle-warehouse/route.ts"),
    "utf8",
  );
  assert.match(source, /listWarmDemand\(\)/);
  // Demand must be merged with, not replace, the operator's pinned list.
  assert.match(source, /configuredSeries\(\)/);
  assert.match(source, /listWarehouseSeries\(\)/);
});

/**
 * Third live layer: history cost scales with the TIME SPAN scanned, not the
 * bar count. Measured on the production feeder (2026-08-07): 1000×15m answers
 * in ~0.5s, 1000×1d takes ~19s against a 12s page timeout — so a full-size
 * daily page timed out on EVERY attempt and the 1d series could never warm,
 * which in turn made the daily refill inside analysis the eternally-cold pull.
 */
test("high-timeframe pages are sized to fit inside the page timeout", () => {
  const source = readFileSync(
    resolve(process.cwd(), "src/lib/ohlc/metaApiOhlc.ts"),
    "utf8",
  );
  assert.match(source, /function pageSizeFor\(interval: string\)/);
  assert.match(source, /if \(interval === "1d"\) return 250/);
  // Both fetch paths must size by interval — a raw MAX_CANDLES page call is
  // the regression this guards against.
  const rawPages = source.match(/fetchPage\([^)]*MAX_CANDLES\)/g) ?? [];
  assert.equal(rawPages.length, 0, "no fetchPage call may pass MAX_CANDLES directly");
});

test("the deep pull stays uncapped for the cron", () => {
  const source = readFileSync(
    resolve(process.cwd(), "src/lib/candles/candleBackfillService.ts"),
    "utf8",
  );
  // maxPages is opt-in: absent, the range fetcher's own ceiling applies, which
  // is what the background job wants.
  assert.match(source, /maxPages\?: number/);
  assert.match(source, /\.\.\.\(params\.maxPages \? \{ maxPages: params\.maxPages \} : \{\}\)/);
});
