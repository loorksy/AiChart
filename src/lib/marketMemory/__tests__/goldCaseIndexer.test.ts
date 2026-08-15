/**
 * The indexer's one invariant: no lookahead.
 *
 * A case claims what the market looked like at a moment AND what happened
 * next. Those halves come from disjoint candle ranges, and mixing them by ONE
 * bar turns the memory into a record of the future — a similarity search that
 * then confidently reports what "usually happens" from situations it was shown
 * the answer to.
 *
 * Nothing about that failure is visible in production. The rows look right, the
 * win rates look good, and the platform quotes a memory that cheated. So the
 * split is tested directly, on data built so that a leak MUST change the
 * answer: the future is engineered to contradict the past.
 */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { before, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "aichart-case-indexer-"));
process.env.DB_PATH = join(dir, "cases.db");
process.env.ENCRYPTION_KEY = "0".repeat(64);
process.env.APP_SECRET = "case-indexer-secret";
delete process.env.DATABASE_URL;

let store: typeof import("@/lib/gold/candleStore");
let indexer: typeof import("@/lib/marketMemory/goldCaseIndexer");
let db: typeof import("@/lib/db");

const HOUR = 60 * 60_000;

/**
 * A series that rises steadily and then collapses.
 *
 * The shape is the test: a fingerprint taken during the rise must never see
 * the collapse, and the outcome resolved from the rise must be the collapse.
 * A slice that overlaps by one bar changes both.
 */
function risingThenFalling(count: number, turnAt: number) {
  const base = Math.floor((Date.now() - count * HOUR) / HOUR) * HOUR;
  const bars = [];
  for (let i = 0; i < count; i += 1) {
    const rising = i < turnAt;
    const price = rising ? 4000 + i * 2 : 4000 + turnAt * 2 - (i - turnAt) * 6;
    bars.push({
      time: base + i * HOUR,
      open: price,
      high: price + 3,
      low: price - 3,
      close: price,
      volume: 10,
    });
  }
  return bars;
}

before(async () => {
  db = await import("@/lib/db");
  await db.initDb();
  store = await import("@/lib/gold/candleStore");
  indexer = await import("@/lib/marketMemory/goldCaseIndexer");
});

describe("the gold case indexer", () => {
  it("does nothing without enough history for a whole case", async () => {
    // A case needs its lookback behind it and its full horizon ahead. Less than
    // that is half a claim, and recording it would report "unresolved" for a
    // market that simply had not printed yet.
    const report = await indexer.indexGoldCases({ timeframe: "1h" });
    assert.equal(report.indexed, 0);
    assert.equal(report.stoppedBecause, "insufficient_history");
  });

  it("indexes both directions at every moment", async () => {
    await store.storeGoldCandles("1h", risingThenFalling(400, 250));
    const report = await indexer.indexGoldCases({ timeframe: "1h", maxCases: 200 });
    assert.ok(report.indexed > 0, "the store now has history to walk");

    const rows = await db.query<{ direction: string; count: number }>(
      "SELECT direction, COUNT(*) AS count FROM market_cases GROUP BY direction",
    );
    const byDirection = Object.fromEntries(rows.map((r) => [r.direction, Number(r.count)]));
    assert.ok(byDirection.buy > 0 && byDirection.sell > 0);
    assert.equal(
      byDirection.buy,
      byDirection.sell,
      "indexing one side would build a memory that can only ever confirm",
    );
  });

  it("fingerprints the moment from BEFORE it, provably", async () => {
    // The decisive check, and the reason it is written this way: an earlier
    // version asserted only that late longs lost money, and a deliberate
    // 30-bar lookahead leak passed it — the collapse still punished late longs
    // whether or not the features had peeked. A weaker test than its own
    // description is worse than none.
    //
    // So the stored features are compared against `fingerprintAt` recomputed
    // over the pre-case window ALONE. If the indexer's window reaches even one
    // bar forward, the trend or range zone it recorded stops matching what the
    // past by itself implies, and this fails.
    const { fingerprintAt } = await import("@/lib/marketMemory/caseFingerprint");
    const candles = await store.readGoldCandles({ timeframe: "1h" });
    const byTime = new Map(candles.map((candle, index) => [candle.time, index]));

    const rows = await db.query<{
      case_time: number | string;
      trend: string;
      range_zone: string;
      regime: string;
    }>(
      `SELECT case_time, trend, range_zone, regime FROM market_cases
        WHERE direction = 'buy' ORDER BY case_time DESC LIMIT 25`,
    );
    assert.ok(rows.length > 0);

    let compared = 0;
    for (const row of rows) {
      const index = byTime.get(Number(row.case_time));
      if (index == null || index < 60) continue;
      const pastOnly = candles.slice(index - 59, index + 1);
      const expected = fingerprintAt(pastOnly);
      if (!expected) continue;
      compared += 1;
      assert.equal(row.trend, expected.trend, `trend at ${row.case_time} saw the future`);
      assert.equal(row.range_zone, expected.rangeZone, `range zone at ${row.case_time} saw the future`);
      assert.equal(row.regime, expected.regime, `regime at ${row.case_time} saw the future`);
    }
    assert.ok(compared >= 10, `expected to verify many cases, verified ${compared}`);
  });

  it("resolves the outcome from what followed, not from what preceded", async () => {
    // The other half of the split. Every case sits on a rise and the series
    // collapses; a long opened at or after the turn must lose, which is only
    // true if the outcome window is the future.
    const rows = await db.query<{ net_r: number | string }>(
      `SELECT net_r FROM market_cases WHERE direction = 'buy'
        ORDER BY case_time DESC LIMIT 20`,
    );
    const losing = rows.filter((row) => Number(row.net_r) < 0).length;
    assert.ok(
      losing > rows.length / 2,
      `expected the collapse to punish late longs, got ${losing}/${rows.length}`,
    );
  });

  it("resumes instead of re-indexing what it already holds", async () => {
    const before = await db.queryOne<{ count: number }>(
      "SELECT COUNT(*) AS count FROM market_cases",
    );
    const report = await indexer.indexGoldCases({ timeframe: "1h", maxCases: 200 });
    const after = await db.queryOne<{ count: number }>(
      "SELECT COUNT(*) AS count FROM market_cases",
    );
    assert.equal(report.indexed, 0);
    assert.equal(
      Number(after?.count),
      Number(before?.count),
      "a second pass over unchanged history must add nothing",
    );
  });

  it("stores excursions in the unit the reader expects", async () => {
    // The column is `max_favourable` and the value is ATR-normalised —
    // caseQuery reads it back as maxFavourableAtr. A price-unit number here
    // would be ~100x larger on gold and silently incomparable.
    const row = await db.queryOne<{ max_favourable: number | string; atr: number | string }>(
      "SELECT max_favourable, atr FROM market_cases WHERE max_favourable > 0 LIMIT 1",
    );
    assert.ok(row, "at least one case had a favourable excursion");
    assert.ok(
      Number(row.max_favourable) < Number(row.atr),
      "an ATR multiple this small cannot be a price distance",
    );
  });
});
