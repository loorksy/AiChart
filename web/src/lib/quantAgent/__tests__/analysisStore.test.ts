import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

/**
 * Quant Agent analysis history store: real SQLite backend, same convention as
 * `monitorStore.test.ts`. Covers the round trip of every JSON sub-object,
 * strict per-user scoping on all three by-id paths, and the keyset cursor.
 */

const OUTLOOK_LEG = { label: "bearish", qualifier: "mild", score: -23.49 };

function outlook() {
  return {
    h24: { ...OUTLOOK_LEG },
    d3: { label: "neutral", qualifier: "neutral", score: -0.14 },
    w1: { label: "neutral", qualifier: "neutral", score: -13.25 },
    m1: { label: "neutral", qualifier: "neutral", score: 8.91 },
  };
}

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

test("analysis store: round-trips a completed analysis and scopes strictly by user", async () => {
  const db = await freshDb("qa-analyses-");
  const owner = await db.insertReturningId(
    "INSERT INTO users (email, password_hash, role, status) VALUES (?,?,?,?)",
    ["analysis-owner@test.com", "x", "user", "active"],
  );
  const other = await db.insertReturningId(
    "INSERT INTO users (email, password_hash, role, status) VALUES (?,?,?,?)",
    ["analysis-other@test.com", "x", "user", "active"],
  );

  const store = await import("@/lib/quantAgent/analysisStore");

  const created = await store.createQuantAnalysis(owner, {
    market: "forex",
    symbol: "XAUUSD",
    interval: "1h",
    status: "completed",
    decision: "SELL",
    confidence: 72,
    currentPrice: 4342.23,
    entryPrice: 4342.23,
    stopLoss: 4359.34,
    takeProfit: 4310.11,
    positionSizePct: 8,
    horizon: "short",
    summary: "Momentum is rolling over.",
    scores: { technical: 38, fundamental: 50, sentiment: 50, overall: 44 },
    consensus: { decision: "HOLD", score: -8, agreement: 0.75, timeframeCount: 4 },
    outlook: outlook(),
    detail: { technical: "RSI 64", fundamental: "no data", sentiment: "no data" },
    reasons: ["Bearish MACD", "Price at upper band"],
    risks: ["Trend could resume"],
    dataQuality: { degraded: false, missing: ["macro", "news_sentiment"] },
  });

  assert.match(created.id, /^[0-9a-f-]{36}$/, "id is a uuid minted by the store");
  assert.equal(created.status, "completed");
  assert.equal(created.decision, "SELL");
  assert.equal(created.confidence, 72);
  assert.equal(created.currentPrice, 4342.23);
  assert.equal(created.horizon, "short");
  assert.deepEqual(created.scores, { technical: 38, fundamental: 50, sentiment: 50, overall: 44 });
  assert.deepEqual(created.consensus, {
    decision: "HOLD",
    score: -8,
    agreement: 0.75,
    timeframeCount: 4,
  });
  assert.deepEqual(created.outlook, outlook());
  assert.deepEqual(created.reasons, ["Bearish MACD", "Price at upper band"]);
  assert.deepEqual(created.risks, ["Trend could resume"]);
  assert.deepEqual(created.dataQuality, { degraded: false, missing: ["macro", "news_sentiment"] });
  assert.equal(created.error, null);
  assert.ok(
    !Number.isNaN(Date.parse(created.createdAt)),
    "createdAt is an ISO-8601 string, not raw epoch ms",
  );

  const reread = await store.getQuantAnalysis(owner, created.id);
  assert.deepEqual(reread, created, "reading it back yields the identical record");

  // --- Strict per-user scoping on every by-id path ---
  assert.equal(
    await store.getQuantAnalysis(other, created.id),
    null,
    "another tenant cannot read it",
  );
  assert.equal(
    await store.deleteQuantAnalysis(other, created.id),
    false,
    "another tenant cannot delete it",
  );
  assert.equal(
    (await store.listQuantAnalyses(other)).items.length,
    0,
    "another tenant's list is empty",
  );

  // --- Delete is idempotent-false ---
  assert.equal(await store.deleteQuantAnalysis(owner, created.id), true);
  assert.equal(await store.getQuantAnalysis(owner, created.id), null);
  assert.equal(await store.deleteQuantAnalysis(owner, created.id), false);
});

test("analysis store: a failed run is still a row, with its reason", async () => {
  const db = await freshDb("qa-analyses-failed-");
  const owner = await db.insertReturningId(
    "INSERT INTO users (email, password_hash, role, status) VALUES (?,?,?,?)",
    ["analysis-failed@test.com", "x", "user", "active"],
  );
  const store = await import("@/lib/quantAgent/analysisStore");

  const failed = await store.createQuantAnalysis(owner, {
    market: "forex",
    symbol: "EURUSD",
    interval: "4h",
    status: "failed",
    error: "تعذّر جلب شموع التحليل لهذا الرمز والإطار الزمني.",
    dataQuality: { degraded: true, missing: ["macro"] },
  });

  assert.equal(failed.status, "failed");
  assert.equal(failed.decision, null, "a failed run asserts no direction");
  assert.equal(failed.confidence, null);
  assert.equal(failed.currentPrice, null);
  assert.deepEqual(failed.scores, {
    technical: null,
    fundamental: null,
    sentiment: null,
    overall: null,
  });
  assert.equal(failed.consensus, null);
  assert.equal(failed.outlook, null);
  assert.deepEqual(failed.reasons, []);
  assert.deepEqual(failed.risks, []);
  assert.equal(failed.error, "تعذّر جلب شموع التحليل لهذا الرمز والإطار الزمني.");

  // Recency memory only ever offers completed runs back to the prompt.
  const priors = await store.listRecentQuantAnalysesForSymbol(owner, "EURUSD");
  assert.equal(priors.length, 0, "a failed analysis is not offered as memory context");
});

test("analysis store: keyset pagination is stable and per-symbol recall is newest-first", async () => {
  const db = await freshDb("qa-analyses-page-");
  const owner = await db.insertReturningId(
    "INSERT INTO users (email, password_hash, role, status) VALUES (?,?,?,?)",
    ["analysis-page@test.com", "x", "user", "active"],
  );
  const store = await import("@/lib/quantAgent/analysisStore");

  const created: string[] = [];
  for (let i = 0; i < 5; i++) {
    // Distinct millisecond per row so "newest first" is unambiguous here; the
    // same-millisecond case is exercised separately below.
    if (i > 0) await new Promise((resolve) => setTimeout(resolve, 2));
    const row = await store.createQuantAnalysis(owner, {
      market: "forex",
      symbol: i % 2 === 0 ? "XAUUSD" : "EURUSD",
      interval: "1h",
      status: "completed",
      decision: "HOLD",
      confidence: 50 + i,
      currentPrice: 100 + i,
    });
    created.push(row.id);
  }

  const first = await store.listQuantAnalyses(owner, { limit: 2 });
  assert.equal(first.items.length, 2);
  assert.ok(first.nextCursor, "a further page is advertised");

  const second = await store.listQuantAnalyses(owner, { limit: 2, cursor: first.nextCursor });
  assert.equal(second.items.length, 2);

  const third = await store.listQuantAnalyses(owner, { limit: 2, cursor: second.nextCursor });
  assert.equal(third.items.length, 1);
  assert.equal(third.nextCursor, null, "the last page advertises no successor");

  const paged = [...first.items, ...second.items, ...third.items].map((a) => a.id);
  assert.equal(new Set(paged).size, 5, "no row is duplicated or skipped across pages");
  assert.deepEqual(paged, [...created].reverse(), "newest first, total order");

  const bySymbol = await store.listQuantAnalyses(owner, { symbol: "XAUUSD" });
  assert.equal(bySymbol.items.length, 3);
  assert.ok(bySymbol.items.every((a) => a.symbol === "XAUUSD"));

  const recall = await store.listRecentQuantAnalysesForSymbol(owner, "XAUUSD", 2);
  assert.equal(recall.length, 2);
  assert.equal(recall[0]!.currentPrice, 104, "most recent first");
  assert.equal(recall[1]!.currentPrice, 102);
});

test("analysis store: rows sharing one millisecond still page without duplicates or gaps", async () => {
  const db = await freshDb("qa-analyses-tie-");
  const owner = await db.insertReturningId(
    "INSERT INTO users (email, password_hash, role, status) VALUES (?,?,?,?)",
    ["analysis-tie@test.com", "x", "user", "active"],
  );
  const store = await import("@/lib/quantAgent/analysisStore");

  // No delay: several of these land in the same millisecond, which is exactly
  // what the (created_at, id) tie-break exists for — without it a cursor of
  // "created_at < X" would drop every sibling written in the same tick.
  const ids = new Set<string>();
  for (let i = 0; i < 6; i++) {
    const row = await store.createQuantAnalysis(owner, {
      market: "forex",
      symbol: "GBPUSD",
      interval: "15m",
      status: "completed",
      decision: "BUY",
    });
    ids.add(row.id);
  }

  const seen: string[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 10; page++) {
    const result: Awaited<ReturnType<typeof store.listQuantAnalyses>> =
      await store.listQuantAnalyses(owner, { limit: 2, cursor });
    seen.push(...result.items.map((a) => a.id));
    cursor = result.nextCursor;
    if (!cursor) break;
  }

  assert.equal(seen.length, 6, "every row is returned exactly once");
  assert.deepEqual(new Set(seen), ids, "no row is duplicated or skipped");
});
