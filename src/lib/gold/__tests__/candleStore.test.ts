/**
 * The gold candle store, against a real database.
 *
 * What these tests hold is the difference between a store a backtest can trust
 * and one that quietly poisons it: only closed bars, only bars the market could
 * have printed, and writes that stay idempotent across the overlapping pages a
 * backfill produces by construction.
 *
 * A backtest reading a forming bar, a duplicated bar, or a bar whose close sits
 * outside its own range does not fail — it produces a win rate. That is the
 * failure mode worth testing for.
 */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { before, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "aichart-gold-store-"));
process.env.DB_PATH = join(dir, "gold.db");
process.env.ENCRYPTION_KEY = "0".repeat(64);
process.env.APP_SECRET = "gold-store-test-secret";
delete process.env.DATABASE_URL;

let store: typeof import("@/lib/gold/candleStore");
let warehouse: typeof import("@/lib/research/warehouse");

const HOUR = 60 * 60_000;

/** A closed hour bar N hours before now, on the hour. */
function bar(hoursAgo: number, over: Partial<{ open: number; high: number; low: number; close: number }> = {}) {
  const time = Math.floor((Date.now() - hoursAgo * HOUR) / HOUR) * HOUR;
  return {
    time,
    open: 4000,
    high: 4010,
    low: 3990,
    close: 4005,
    volume: 100,
    ...over,
  };
}

before(async () => {
  const db = await import("@/lib/db");
  await db.initDb();
  store = await import("@/lib/gold/candleStore");
  warehouse = await import("@/lib/research/warehouse");
});

describe("the gold candle store", () => {
  it("keeps only frames it was built for", async () => {
    await assert.rejects(
      () => store.readGoldCandles({ timeframe: "1m" }),
      /does not keep/,
    );
    for (const timeframe of store.STORED_TIMEFRAMES) {
      await store.readGoldCandles({ timeframe });
    }
  });

  it("stores closed bars and reads them oldest-first", async () => {
    const written = await store.storeGoldCandles("1h", [bar(5), bar(3), bar(4)]);
    assert.equal(written, 3);
    const read = await store.readGoldCandles({ timeframe: "1h" });
    assert.equal(read.length, 3);
    assert.ok(
      read[0]!.time < read[1]!.time && read[1]!.time < read[2]!.time,
      "a backtest loop walks forward through time",
    );
  });

  it("refuses a bar that has not closed yet", async () => {
    // The bar that is forming right now: its high and low are still moving, and
    // a backtest reading it would be trading the future.
    const forming = { ...bar(0), time: Math.floor(Date.now() / HOUR) * HOUR };
    const written = await store.storeGoldCandles("1h", [forming]);
    assert.equal(written, 0);
  });

  it("is idempotent — an overlapping page writes nothing new", async () => {
    const page = [bar(9), bar(8), bar(7)];
    assert.equal(await store.storeGoldCandles("1h", page), 3);
    // Backfill windows overlap by construction; the boundary bar arrives twice.
    assert.equal(await store.storeGoldCandles("1h", page), 0);
    const range = await store.goldCandleRange("1h");
    assert.equal(range.count, 6, "three from the earlier test, three from this one");
  });

  it("refuses bars the market could not have printed", async () => {
    const impossible = [
      bar(20, { high: 3990, low: 4010 }), // high below its own low
      bar(21, { close: 4999 }), // close outside the bar's range
      bar(22, { open: -1 }), // a non-positive price
    ];
    assert.equal(
      await store.storeGoldCandles("1h", impossible),
      0,
      "a corrupt bar does not fail a backtest — it produces a win rate",
    );
  });

  it("returns the most RECENT bars when a limit is given", async () => {
    const read = await store.readGoldCandles({ timeframe: "1h", limit: 2 });
    const all = await store.readGoldCandles({ timeframe: "1h" });
    assert.equal(read.length, 2);
    assert.deepEqual(
      read.map((c) => c.time),
      all.slice(-2).map((c) => c.time),
      "\"the last N bars\" means the newest N, not the start of history",
    );
  });
});

describe("the research warehouse envelope", () => {
  it("builds the dialect the research service already validates", async () => {
    const envelope = await warehouse.exportGoldWarehouseEnvelope({
      symbol: "XAUUSD",
      timeframe: "1h",
      limit: 10,
    });
    assert.equal(envelope.schema_version, "aichart-candle-warehouse-v1");
    assert.equal(envelope.closed_bars_only, true);
    assert.ok(envelope.bars.length > 0);
    for (const bar of envelope.bars) {
      assert.equal(bar.is_closed, true);
      assert.equal(bar.symbol, "XAUUSD");
      assert.equal(bar.timeframe, "1h");
      assert.equal(bar.timezone, "UTC");
      // Mid prices with no book: null says "no spread was observed", where a
      // zero would claim a spread-free market.
      assert.equal(bar.spread, null);
    }
  });

  it("refuses any instrument but gold", async () => {
    await assert.rejects(
      () => warehouse.exportGoldWarehouseEnvelope({ symbol: "EURUSD", timeframe: "1h" }),
      /XAUUSD only/,
    );
  });

  it("names the empty store rather than shipping a zero-bar envelope", async () => {
    // The remote validator rejects an empty envelope anyway, but as "invalid
    // envelope" from a service — not as the fact the operator can act on.
    await assert.rejects(
      () => warehouse.exportGoldWarehouseEnvelope({ symbol: "XAUUSD", timeframe: "4h" }),
      /holds no 4h bars/,
    );
  });

  it("refuses a range that runs into the future", async () => {
    await assert.rejects(
      () =>
        warehouse.exportGoldWarehouseEnvelope({
          symbol: "XAUUSD",
          timeframe: "1h",
          fromMs: Date.now() + HOUR,
        }),
      /cannot be in the future/,
    );
  });
});
