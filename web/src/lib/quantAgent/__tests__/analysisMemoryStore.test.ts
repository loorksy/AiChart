import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

/**
 * The Wave-2 half of the analysis store: the indicator fingerprint, the
 * validated-candidate pool memory recall reads, the idempotent outcome write,
 * the confidence-bucket hit rate and the calibration sample pull. Real SQLite
 * backend, same convention as `analysisStore.test.ts`.
 *
 * The properties that actually matter here are refusals: a row with no
 * fingerprint is not recallable, a row already validated is not re-scored, and
 * a confidence bucket under five samples is not reported at all.
 *
 * `@/lib/db` is a module singleton, so every test in this file shares ONE
 * database however many times `freshDb` is called (the same caveat
 * `dbUserScope.test.ts` documents). Per-user reads are naturally isolated by
 * their own scoping; the two DELIBERATELY cross-user sweep queries are
 * asserted by membership rather than by exact equality, so they stay correct
 * whatever else the file has written.
 */

const FINGERPRINT = {
  rsi: 64.4,
  macd_signal: "bearish",
  ma_trend: "uptrend",
  volatility_level: "medium",
  price_position: 65.5,
} as const;

async function freshDb(prefix: string) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  process.env.DB_PATH = join(dir, "test.db");
  process.env.ENCRYPTION_KEY = "0".repeat(64);
  process.env.APP_SECRET = "test-secret";
  delete process.env.DATABASE_URL;
  const db = await import("@/lib/db");
  await db.initDb();
  return db;
}

type Store = typeof import("@/lib/quantAgent/analysisStore");

async function seedUser(db: Awaited<ReturnType<typeof freshDb>>, email: string): Promise<number> {
  return db.insertReturningId(
    "INSERT INTO users (email, password_hash, role, status) VALUES (?,?,?,?)",
    [email, "x", "user", "active"],
  );
}

/** Writes a completed analysis and back-dates it, since `created_at` is minted. */
async function seedAnalysis(
  db: Awaited<ReturnType<typeof freshDb>>,
  store: Store,
  userId: number,
  overrides: {
    symbol?: string;
    decision?: "BUY" | "SELL" | "HOLD";
    confidence?: number | null;
    currentPrice?: number | null;
    consensusScore?: number;
    indicators?: Record<string, unknown> | null;
    createdAtMsAgo?: number;
  } = {},
): Promise<string> {
  const record = await store.createQuantAnalysis(userId, {
    market: "forex",
    symbol: overrides.symbol ?? "XAUUSD",
    interval: "1h",
    status: "completed",
    decision: overrides.decision ?? "BUY",
    confidence: overrides.confidence === undefined ? 75 : overrides.confidence,
    currentPrice: overrides.currentPrice === undefined ? 100 : overrides.currentPrice,
    consensus: {
      decision: "BUY",
      score: overrides.consensusScore ?? 25,
      agreement: 0.8,
      timeframeCount: 3,
    },
    indicators:
      overrides.indicators === undefined
        ? { ...FINGERPRINT }
        : (overrides.indicators as never),
  });
  if (overrides.createdAtMsAgo) {
    await db.execute("UPDATE quant_analyses SET created_at = ? WHERE id = ?", [
      Date.now() - overrides.createdAtMsAgo,
      record.id,
    ]);
  }
  return record.id;
}

test("analysis store: the indicator fingerprint round-trips into a recallable candidate", async () => {
  const db = await freshDb("qa-mem-fingerprint-");
  const owner = await seedUser(db, "mem-owner@test.com");
  const store: Store = await import("@/lib/quantAgent/analysisStore");

  const id = await seedAnalysis(db, store, owner, { decision: "SELL", currentPrice: 4342.23 });

  // Unvalidated: memory must stay silent, exactly as upstream's
  // `validated_at IS NOT NULL` filter makes it.
  assert.deepEqual(await store.listSimilarQuantAnalysesForSymbol(owner, "XAUUSD"), []);

  assert.equal(
    await store.recordQuantAnalysisValidation({
      id,
      wasCorrect: true,
      realisedPrice: 4200,
      realisedReturnPct: -3.28,
    }),
    true,
  );

  const [candidate] = await store.listSimilarQuantAnalysesForSymbol(owner, "XAUUSD");
  assert.ok(candidate, "a validated analysis with a fingerprint is recallable");
  assert.equal(candidate.id, id);
  assert.equal(candidate.decision, "SELL");
  assert.equal(candidate.wasCorrect, true);
  assert.equal(candidate.priceAtAnalysis, 4342.23);
  assert.equal(candidate.realisedReturnPct, -3.28);
  assert.deepEqual(candidate.indicators, { ...FINGERPRINT });
});

test("analysis store: a validated row with no fingerprint is not recallable", async () => {
  const db = await freshDb("qa-mem-nofingerprint-");
  const owner = await seedUser(db, "mem-nofp@test.com");
  const store: Store = await import("@/lib/quantAgent/analysisStore");

  // A Wave-1 row: validated later, but nothing to compare against.
  const id = await seedAnalysis(db, store, owner, { indicators: null });
  await store.recordQuantAnalysisValidation({
    id,
    wasCorrect: true,
    realisedPrice: 105,
    realisedReturnPct: 5,
  });

  assert.deepEqual(
    await store.listSimilarQuantAnalysesForSymbol(owner, "XAUUSD"),
    [],
    "comparing against quant-agent's neutral defaults would rank a blank row as similar to everything",
  );
});

test("analysis store: the candidate pool is limit*5, newest validation first, and user-scoped", async () => {
  const db = await freshDb("qa-mem-pool-");
  const owner = await seedUser(db, "mem-pool-owner@test.com");
  const other = await seedUser(db, "mem-pool-other@test.com");
  const store: Store = await import("@/lib/quantAgent/analysisStore");

  const ids: string[] = [];
  for (let index = 0; index < 20; index += 1) {
    const id = await seedAnalysis(db, store, owner);
    await store.recordQuantAnalysisValidation({
      id,
      wasCorrect: index % 2 === 0,
      realisedPrice: 103,
      realisedReturnPct: 3,
      // Explicit, ascending: the pool is ordered by validation recency.
      validatedAt: 1_700_000_000_000 + index * 1000,
    });
    ids.push(id);
  }
  const foreign = await seedAnalysis(db, store, other);
  await store.recordQuantAnalysisValidation({
    id: foreign,
    wasCorrect: true,
    realisedPrice: 103,
    realisedReturnPct: 3,
    validatedAt: 1_800_000_000_000,
  });

  const pool = await store.listSimilarQuantAnalysesForSymbol(owner, "XAUUSD", 3);

  assert.equal(pool.length, 15, "limit 3 pulls a pool of limit*5");
  assert.deepEqual(
    pool.map((row) => row.id),
    ids.slice(5).reverse(),
    "newest validation first",
  );
  assert.ok(
    !pool.some((row) => row.id === foreign),
    "another tenant's analysis is never recalled as your own memory",
  );
});

test("analysis store: the validation claim query takes only aged, unvalidated, priced rows", async () => {
  const db = await freshDb("qa-mem-claim-");
  const owner = await seedUser(db, "mem-claim@test.com");
  const store: Store = await import("@/lib/quantAgent/analysisStore");

  const day = 86_400_000;
  const aged = await seedAnalysis(db, store, owner, { createdAtMsAgo: 10 * day });
  const tooYoung = await seedAnalysis(db, store, owner, { createdAtMsAgo: 2 * day });
  const unpriced = await seedAnalysis(db, store, owner, {
    createdAtMsAgo: 10 * day,
    currentPrice: null,
  });
  const alreadyDone = await seedAnalysis(db, store, owner, { createdAtMsAgo: 30 * day });
  await store.recordQuantAnalysisValidation({
    id: alreadyDone,
    wasCorrect: false,
    realisedPrice: 90,
    realisedReturnPct: -10,
  });

  const pending = await store.listQuantAnalysesAwaitingValidation({
    olderThanMs: Date.now() - 7 * day,
    limit: 50,
  });
  const ids = new Set(pending.map((row) => row.id));

  assert.ok(ids.has(aged), "an aged, unvalidated, priced analysis is claimed");
  assert.ok(!ids.has(tooYoung), "a 2-day-old call has not had time to be right or wrong");
  assert.ok(!ids.has(unpriced), "no base price means no move to measure");
  assert.ok(!ids.has(alreadyDone), "an already-scored row is never re-claimed");

  const claimed = pending.find((row) => row.id === aged)!;
  assert.equal(claimed.priceAtAnalysis, 100);
  assert.equal(claimed.userId, owner);
});

test("analysis store: an outcome is written once — a second pass cannot overwrite it", async () => {
  const db = await freshDb("qa-mem-idempotent-");
  const owner = await seedUser(db, "mem-idem@test.com");
  const store: Store = await import("@/lib/quantAgent/analysisStore");

  const id = await seedAnalysis(db, store, owner);
  assert.equal(
    await store.recordQuantAnalysisValidation({
      id,
      wasCorrect: true,
      realisedPrice: 106,
      realisedReturnPct: 6,
    }),
    true,
  );
  assert.equal(
    await store.recordQuantAnalysisValidation({
      id,
      wasCorrect: false,
      realisedPrice: 80,
      realisedReturnPct: -20,
    }),
    false,
    "the second write is refused, so two racing cron ticks cannot re-score a row",
  );

  const [candidate] = await store.listSimilarQuantAnalysesForSymbol(owner, "XAUUSD");
  assert.equal(candidate!.wasCorrect, true);
  assert.equal(candidate!.realisedReturnPct, 6);
});

test("analysis store: a confidence bucket under five samples is omitted, never shown as a hit rate", async () => {
  const db = await freshDb("qa-mem-buckets-");
  const owner = await seedUser(db, "mem-buckets@test.com");
  const store: Store = await import("@/lib/quantAgent/analysisStore");

  // 70–79: eight rows, six right. 80–89: four rows, all right — under the floor.
  for (let index = 0; index < 8; index += 1) {
    const id = await seedAnalysis(db, store, owner, { confidence: 75 });
    await store.recordQuantAnalysisValidation({
      id,
      wasCorrect: index < 6,
      realisedPrice: 103,
      realisedReturnPct: 3,
    });
  }
  for (let index = 0; index < 4; index += 1) {
    const id = await seedAnalysis(db, store, owner, { confidence: 85 });
    await store.recordQuantAnalysisValidation({
      id,
      wasCorrect: true,
      realisedPrice: 103,
      realisedReturnPct: 3,
    });
  }

  const summary = await store.getQuantAnalysisAccuracy(owner);

  assert.deepEqual(
    summary.buckets.map((bucket) => bucket.key),
    ["70_80"],
    "four-out-of-four is not a 100% hit rate",
  );
  assert.equal(summary.buckets[0]!.samples, 8);
  assert.equal(summary.buckets[0]!.hitRate, 0.75);
  assert.equal(summary.validatedCount, 12, "every scored row is still counted");
  assert.equal(summary.measuredCount, 8, "only the reported bucket's rows are 'measured'");
});

test("analysis store: accuracy is user-scoped and can narrow to one symbol", async () => {
  const db = await freshDb("qa-mem-scope-");
  const owner = await seedUser(db, "mem-scope-owner@test.com");
  const other = await seedUser(db, "mem-scope-other@test.com");
  const store: Store = await import("@/lib/quantAgent/analysisStore");

  for (let index = 0; index < 6; index += 1) {
    const mine = await seedAnalysis(db, store, owner, { confidence: 65, symbol: "EURUSD" });
    await store.recordQuantAnalysisValidation({
      id: mine,
      wasCorrect: true,
      realisedPrice: 103,
      realisedReturnPct: 3,
    });
    const theirs = await seedAnalysis(db, store, other, { confidence: 65 });
    await store.recordQuantAnalysisValidation({
      id: theirs,
      wasCorrect: false,
      realisedPrice: 90,
      realisedReturnPct: -10,
    });
  }

  const mine = await store.getQuantAnalysisAccuracy(owner);
  assert.equal(mine.validatedCount, 6);
  assert.equal(mine.buckets[0]!.hitRate, 1);

  const perSymbol = await store.getQuantAnalysisAccuracy(owner, { symbol: "XAUUSD" });
  assert.deepEqual(perSymbol.buckets, []);
  assert.equal(perSymbol.validatedCount, 0);
});

test("analysis store: calibration samples carry the consensus score and drop rows without one", async () => {
  const db = await freshDb("qa-mem-calibration-");
  const owner = await seedUser(db, "mem-cal@test.com");
  const store: Store = await import("@/lib/quantAgent/analysisStore");

  const scored = await seedAnalysis(db, store, owner, { consensusScore: 31.5, confidence: 82 });
  await store.recordQuantAnalysisValidation({
    id: scored,
    wasCorrect: true,
    // -13.25 and 31.5 are markers no other test in this file writes, so the
    // assertions below stay exact even though this query is cross-user.
    realisedPrice: 86.75,
    realisedReturnPct: -13.25,
  });
  // Validated, but the consensus was never recorded: it cannot contribute to a
  // search over consensus scores, and an invented 0 would corrupt the grid.
  await db.execute(
    `INSERT INTO quant_analyses
       (id, user_id, market, symbol, interval, status, decision, confidence, current_price,
        created_at, validated_at, was_correct, realised_return_pct)
     VALUES ('no-consensus-row', ?, 'forex', 'XAUUSD', '1h', 'completed', 'BUY', 80, 100,
             ?, ?, 1, -17.5)`,
    [owner, Date.now(), Date.now()],
  );
  // Unvalidated rows are excluded too.
  await seedAnalysis(db, store, owner, { consensusScore: -44.25 });

  const samples = await store.listQuantAnalysisCalibrationSamples({
    sinceMs: Date.now() - 30 * 86_400_000,
    limit: 5000,
  });

  assert.deepEqual(
    samples.filter((sample) => sample.actualReturnPct === -13.25),
    [{ consensusScore: 31.5, actualReturnPct: -13.25, confidence: 82, wasCorrect: true }],
  );
  assert.ok(
    !samples.some((sample) => sample.actualReturnPct === -17.5),
    "a validated row with no recorded consensus contributes nothing rather than a fabricated 0",
  );
  assert.ok(
    !samples.some((sample) => sample.consensusScore === -44.25),
    "an unvalidated row has no realised move to calibrate against",
  );
});
