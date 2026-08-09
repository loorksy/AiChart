import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { before, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "aichart-case-memory-"));
process.env.DB_PATH = join(dir, "cases.db");
process.env.ENCRYPTION_KEY = "0".repeat(64);
process.env.APP_SECRET = "case-memory-test-secret";
delete process.env.DATABASE_URL;

const HOUR = 3_600_000;
const SYMBOL = "EURUSD";
const INTERVAL = "1h";
const START = Date.parse("2025-01-06T00:00:00Z");

/**
 * A long ramp with a shallow wobble. Deterministic and monotone enough that the
 * outcomes are predictable, varied enough that the fingerprints are not all one
 * value.
 */
function rampCandles(count: number, from = 0) {
  const candles = [];
  for (let i = from; i < from + count; i++) {
    const base = 1.05 + i * 0.0004 + Math.sin(i / 7) * 0.0008;
    const close = Number(base.toFixed(6));
    const open = Number((base - 0.0002).toFixed(6));
    candles.push({
      time: START + i * HOUR,
      open,
      high: Number((Math.max(open, close) + 0.0004).toFixed(6)),
      low: Number((Math.min(open, close) - 0.0004).toFixed(6)),
      close,
      volume: 100,
      complete: true,
    });
  }
  return candles;
}

let indexer: typeof import("@/lib/marketMemory/caseIndexer");
let repo: typeof import("@/lib/candles/candleRepository");
let db: typeof import("@/lib/db");

before(async () => {
  db = await import("@/lib/db");
  await db.initDb();
  repo = await import("@/lib/candles/candleRepository");
  indexer = await import("@/lib/marketMemory/caseIndexer");
});

async function storedCases(): Promise<
  Array<{
    case_time: number;
    direction: string;
    trend: string;
    pullback_depth: number;
    impulse_atr: number;
    structure_run: number;
    outcome: string | null;
    net_r: number | null;
  }>
> {
  const rows = await db.query<Record<string, unknown>>(
    `SELECT case_time, direction, trend, pullback_depth, impulse_atr,
            structure_run, outcome, net_r
       FROM market_cases
      WHERE symbol = ? AND interval = ?
      ORDER BY case_time ASC, direction ASC`,
    [SYMBOL, INTERVAL],
  );
  return rows.map((row) => ({
    case_time: Number(row.case_time),
    direction: String(row.direction),
    trend: String(row.trend),
    pullback_depth: Number(row.pullback_depth),
    impulse_atr: Number(row.impulse_atr),
    structure_run: Number(row.structure_run),
    outcome: row.outcome == null ? null : String(row.outcome),
    net_r: row.net_r == null ? null : Number(row.net_r),
  }));
}

describe("case indexer", () => {
  it("indexes both directions for each moment and resolves what it can", async () => {
    await repo.upsertCandles(SYMBOL, INTERVAL, rampCandles(400));
    const result = await indexer.indexSymbolCases({
      symbol: SYMBOL,
      interval: INTERVAL,
      detectPatterns: false,
      stride: 20,
    });

    assert.ok(result.written > 0, "the walk produced no cases");
    const cases = await storedCases();
    assert.equal(cases.length, result.written);

    // Every moment is stored twice — once per direction — so the memory can be
    // asked about a long and a short from the same setup.
    const times = new Set(cases.map((row) => row.case_time));
    assert.equal(cases.length, times.size * 2);
    for (const time of times) {
      const pair = cases.filter((row) => row.case_time === time);
      assert.deepEqual(
        pair.map((row) => row.direction).sort(),
        ["buy", "sell"],
        `moment ${time} is missing a direction`,
      );
    }
  });

  /**
   * The rule the whole memory rests on. Adding candles after a case must leave
   * that case's FEATURES untouched — if they shift, every statistic derived from
   * them was computed with knowledge of the future.
   */
  it("does not alter an indexed case when later candles arrive", async () => {
    const before = await storedCases();
    assert.ok(before.length > 0);

    // 200 more bars, sharply reversing — the most disruptive continuation.
    const reversal = rampCandles(200, 400).map((candle, i) => {
      const drop = i * 0.0009;
      return {
        ...candle,
        open: Number((candle.open - drop).toFixed(6)),
        high: Number((candle.high - drop).toFixed(6)),
        low: Number((candle.low - drop).toFixed(6)),
        close: Number((candle.close - drop).toFixed(6)),
      };
    });
    await repo.upsertCandles(SYMBOL, INTERVAL, reversal);
    await indexer.indexSymbolCases({
      symbol: SYMBOL,
      interval: INTERVAL,
      detectPatterns: false,
      stride: 20,
    });

    const after = await storedCases();
    assert.ok(after.length > before.length, "the second pass indexed nothing new");

    for (const original of before) {
      const current = after.find(
        (row) => row.case_time === original.case_time && row.direction === original.direction,
      );
      assert.ok(current, `case ${original.case_time} disappeared`);
      assert.equal(current.trend, original.trend, "trend changed retroactively");
      assert.equal(
        current.pullback_depth,
        original.pullback_depth,
        "pullback depth changed retroactively",
      );
      assert.equal(current.impulse_atr, original.impulse_atr, "impulse changed retroactively");
      assert.equal(
        current.structure_run,
        original.structure_run,
        "structure run changed retroactively",
      );
    }
  });

  it("fills in outcomes only once the forward window has actually arrived", async () => {
    const pendingBefore = (await storedCases()).filter((row) => row.outcome == null);
    assert.ok(pendingBefore.length > 0, "expected unresolved cases at the edge of history");

    await indexer.resolvePendingCases({ symbol: SYMBOL, interval: INTERVAL });

    // The property that matters: a case is resolved only when the warehouse
    // actually holds its whole forward window. Anything closer to the edge than
    // the horizon must still be pending — resolving it would mean reading an
    // outcome off a truncated future.
    const latest = (
      await repo.getCandles({ symbol: SYMBOL, interval: INTERVAL, limit: 1 })
    )[0]!.time;
    for (const row of await storedCases()) {
      const future = await repo.getCandles({
        symbol: SYMBOL,
        interval: INTERVAL,
        fromMs: row.case_time + 1,
        order: "asc",
        limit: indexer.FORWARD_HORIZON,
      });
      if (future.length < indexer.FORWARD_HORIZON) {
        assert.equal(
          row.outcome,
          null,
          `case ${row.case_time} was resolved with only ${future.length} bars of future (latest bar ${latest})`,
        );
      }
      if (row.outcome != null) {
        assert.ok(
          ["target_first", "stop_first", "unresolved", "false_break"].includes(row.outcome),
          `unexpected outcome ${row.outcome}`,
        );
        assert.ok(row.net_r != null, "a resolved case with no net R");
      }
    }

    // And once the future does arrive, the pending cases get their answer.
    await repo.upsertCandles(SYMBOL, INTERVAL, rampCandles(200, 600));
    const resolved = await indexer.resolvePendingCases({
      symbol: SYMBOL,
      interval: INTERVAL,
    });
    assert.ok(resolved > 0, "the arrived future resolved nothing");
    const pendingAfter = (await storedCases()).filter((row) => row.outcome == null);
    assert.ok(
      pendingAfter.length < pendingBefore.length,
      "the pending count did not fall after resolution",
    );
  });

  it("is idempotent — re-walking the same candles adds nothing", async () => {
    // Rewinding past the resume cursor makes the conflict rule and the lattice
    // do the work, which is exactly what has to hold. Bring the index current
    // first, so the second walk is a genuine repeat rather than a catch-up.
    const walk = () =>
      indexer.indexSymbolCases({
        symbol: SYMBOL,
        interval: INTERVAL,
        detectPatterns: false,
        stride: 20,
        fromMs: 0,
      });

    await walk();
    const before = await storedCases();
    const repeat = await walk();
    const after = await storedCases();

    assert.equal(repeat.written, 0, "a repeated walk wrote rows");
    assert.equal(after.length, before.length, "re-indexing created duplicate cases");
    // The same moments, described the same way — not just the same count.
    assert.deepEqual(after, before, "a repeated walk changed stored cases");
  });
});

describe("partial-stage outcomes", () => {
  const FORMING_SYMBOL = "GBPUSD";

  /** One synthetic stored case; only the fields under test vary. */
  function syntheticCase(
    over: Partial<import("@/lib/marketMemory/caseIndexer").IndexedCase>,
  ): import("@/lib/marketMemory/caseIndexer").IndexedCase {
    return {
      symbol: FORMING_SYMBOL,
      interval: INTERVAL,
      caseTime: START,
      direction: "buy",
      regime: "trend",
      trend: "up",
      rangeZone: "premium",
      pullbackDepth: 0.3,
      impulseAtr: 2,
      volatility: 0.001,
      session: "london",
      structureRun: 3,
      patternName: "ascending_triangle",
      patternStage: "forming",
      breakLevel: null,
      breakDirection: null,
      entryPrice: 0,
      atr: 0.001,
      outcome: null,
      outcomeBars: null,
      maxFavourable: null,
      maxAdverse: null,
      netR: null,
      formingOutcome: null,
      formingBars: null,
      falseBreak: null,
      earlyNetR: null,
      confirmedNetR: null,
      sessionCost: null,
      ...over,
    };
  }

  it("computes partial-stage outcomes for forming cases and leaves completed ones null", async () => {
    await repo.upsertCandles(FORMING_SYMBOL, INTERVAL, rampCandles(400));
    const candles = await repo.getCandles({
      symbol: FORMING_SYMBOL,
      interval: INTERVAL,
      order: "asc",
      limit: 400,
    });
    const at = candles[200]!;

    // A forming pattern pressing a boundary just above the ramp, and a control
    // case whose pattern had already confirmed by its case time.
    const written = await indexer.storeCases([
      syntheticCase({
        caseTime: at.time,
        direction: "buy",
        patternStage: "forming",
        breakLevel: at.close + 0.0005,
        breakDirection: "up",
        entryPrice: at.close,
      }),
      syntheticCase({
        caseTime: at.time,
        direction: "sell",
        patternStage: "confirmed",
        breakLevel: at.close + 0.0005,
        breakDirection: "up",
        entryPrice: at.close,
      }),
    ]);
    assert.equal(written, 2);

    await indexer.resolvePendingCases({ symbol: FORMING_SYMBOL, interval: INTERVAL });

    const rows = await db.query<Record<string, unknown>>(
      `SELECT direction, outcome, forming_outcome, forming_bars, false_break,
              early_net_r, confirmed_net_r, session_cost
         FROM market_cases
        WHERE symbol = ? AND interval = ? AND case_time = ?
        ORDER BY direction ASC`,
      [FORMING_SYMBOL, INTERVAL, at.time],
    );
    assert.equal(rows.length, 2);

    const forming = rows.find((row) => row.direction === "buy")!;
    assert.ok(forming.outcome != null, "the plain outcome resolved");
    assert.equal(
      forming.forming_outcome,
      "completed",
      "the rising ramp closes beyond the boundary",
    );
    assert.ok(Number(forming.forming_bars) >= 1);
    assert.ok(forming.early_net_r != null, "the early entry was measured");
    assert.ok(forming.confirmed_net_r != null, "the confirmed entry was measured");
    assert.ok(
      forming.session_cost != null && Number(forming.session_cost) > 0,
      "the session cost was charged",
    );

    // A pattern already past its forming stages answers no partial question.
    const confirmed = rows.find((row) => row.direction === "sell")!;
    assert.ok(confirmed.outcome != null, "the control case still resolves normally");
    assert.equal(confirmed.forming_outcome, null);
    assert.equal(confirmed.false_break, null);
    assert.equal(confirmed.early_net_r, null);
    assert.equal(confirmed.session_cost, null);
  });

  it("never fills partial outcomes for legacy rows without a frozen boundary", async () => {
    const candles = await repo.getCandles({
      symbol: FORMING_SYMBOL,
      interval: INTERVAL,
      order: "asc",
      limit: 400,
    });
    const at = candles[220]!;
    // A forming stage but no stored boundary — exactly the shape of a row
    // indexed before the columns existed.
    await indexer.storeCases([
      syntheticCase({
        caseTime: at.time,
        direction: "buy",
        patternStage: "forming",
        breakLevel: null,
        breakDirection: null,
        entryPrice: at.close,
      }),
    ]);
    await indexer.resolvePendingCases({ symbol: FORMING_SYMBOL, interval: INTERVAL });

    const rows = await db.query<Record<string, unknown>>(
      `SELECT outcome, forming_outcome FROM market_cases
        WHERE symbol = ? AND interval = ? AND case_time = ? AND direction = 'buy'`,
      [FORMING_SYMBOL, INTERVAL, at.time],
    );
    assert.equal(rows.length, 1);
    assert.ok(rows[0]!.outcome != null, "the plain outcome still resolves");
    assert.equal(rows[0]!.forming_outcome, null, "no boundary, no partial claim");
  });
});

describe("similar-case queries", () => {
  it("only returns cases from before the moment asked about", async () => {
    const { findSimilarCases } = await import("@/lib/marketMemory/caseQuery");
    const { fingerprintAt } = await import("@/lib/marketMemory/caseFingerprint");
    const candles = await repo.getCandles({
      symbol: SYMBOL,
      interval: INTERVAL,
      order: "asc",
      limit: 400,
    });
    const fingerprint = fingerprintAt(candles.slice(0, 300));
    assert.ok(fingerprint);

    const cutoff = candles[300]!.time;
    const result = await findSimilarCases({
      symbol: SYMBOL,
      interval: INTERVAL,
      fingerprint,
      direction: "buy",
      beforeMs: cutoff,
      minSimilarity: 0.5,
    });
    for (const entry of result.cases) {
      assert.ok(
        entry.caseTime < cutoff,
        `case ${entry.caseTime} is not older than the cutoff ${cutoff}`,
      );
    }
  });

  it("ranks a moment's closest matches first and never returns an unresolved one", async () => {
    const { findSimilarCases } = await import("@/lib/marketMemory/caseQuery");
    const { fingerprintAt } = await import("@/lib/marketMemory/caseFingerprint");
    const candles = await repo.getCandles({
      symbol: SYMBOL,
      interval: INTERVAL,
      order: "asc",
      limit: 500,
    });
    const fingerprint = fingerprintAt(candles.slice(0, 200))!;
    const result = await findSimilarCases({
      symbol: SYMBOL,
      interval: INTERVAL,
      fingerprint,
      direction: "buy",
      minSimilarity: 0.5,
    });

    assert.ok(result.cases.length > 0, "no similar cases found in a self-similar series");
    for (let i = 1; i < result.cases.length; i++) {
      assert.ok(
        result.cases[i - 1]!.similarity >= result.cases[i]!.similarity,
        "results are not ordered by similarity",
      );
    }
    // An unresolved case has no answer to the question being asked; counting it
    // would dilute every rate computed from the set.
    for (const entry of result.cases) {
      assert.ok(entry.outcome.resolution, "a case with no resolution was returned");
    }
  });

  it("reports a small sample as a count, not a rate", async () => {
    const { findSimilarCases } = await import("@/lib/marketMemory/caseQuery");
    const { fingerprintAt } = await import("@/lib/marketMemory/caseFingerprint");
    const candles = await repo.getCandles({
      symbol: SYMBOL,
      interval: INTERVAL,
      order: "asc",
      limit: 300,
    });
    const fingerprint = fingerprintAt(candles.slice(0, 200))!;
    const result = await findSimilarCases({
      symbol: SYMBOL,
      interval: INTERVAL,
      fingerprint,
      direction: "buy",
      minSimilarity: 0.5,
      limit: 3,
    });
    assert.equal(result.cases.length, 3);
    assert.equal(result.statisticallyUsable, false);
    assert.equal(result.stats.hitRate, null, "3 cases must not be quoted as a percentage");
  });

  it("says nothing at all for an instrument it has never indexed", async () => {
    const { collectCaseEvidence } = await import("@/lib/marketMemory/caseQuery");
    const { fingerprintAt } = await import("@/lib/marketMemory/caseFingerprint");
    const fingerprint = fingerprintAt(
      rampCandles(80).map(({ time, open, high, low, close }) => ({
        time,
        open,
        high,
        low,
        close,
      })),
    )!;
    const evidence = await collectCaseEvidence({
      symbol: "GBPJPY",
      interval: INTERVAL,
      fingerprint,
    });
    assert.equal(evidence, null, "an unindexed instrument must not produce evidence");
  });
});
