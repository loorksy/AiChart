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
