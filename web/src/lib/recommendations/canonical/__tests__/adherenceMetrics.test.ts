import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { before, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "aichart-adherence-"));
process.env.DB_PATH = join(dir, "adherence.db");
process.env.ENCRYPTION_KEY = "0".repeat(64);
process.env.APP_SECRET = "adherence-test-secret";
delete process.env.DATABASE_URL;

/**
 * Adherence metrics in their canonical home (plan §15 J), against a real
 * database.
 *
 * Entry/stop adherence lived in the performance journal while early-exit and
 * entry-delay were re-derived ad hoc inside the journal API route. The
 * analytics module now owns all four, and these tests pin the definitions:
 * late entry is the FIRST activation to the FIRST linked trade; early exit is
 * a manual close BEFORE any take-profit outcome — a manual close after TP1 is
 * management, not abandonment.
 */

let db: typeof import("@/lib/db");
let analytics: typeof import("@/lib/recommendations/canonical/analytics");
let userId = 0;

before(async () => {
  db = await import("@/lib/db");
  await db.initDb();
  analytics = await import("@/lib/recommendations/canonical/analytics");
  userId = await db.insertReturningId(
    "INSERT INTO users (email, password_hash, role, status) VALUES (?,?,?,?)",
    ["adherence@example.com", "x", "user", "active"],
  );
});

async function recommendation(): Promise<number> {
  return db.insertReturningId(
    `INSERT INTO recommendations
       (user_id, symbol, market, timeframe, action, direction, confidence,
        strategy_id, strategy_version, status, status_reason, source,
        engine_version, entry, stop_loss, expires_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      userId, "EURUSD", "forex", "5m", "buy", "buy", 70,
      "unspecified", "1", "active", "test", "test", "adherence-test",
      1.1, 1.09, Date.now() + 3_600_000,
    ],
  );
}

async function triggered(recommendationId: number, at: number): Promise<void> {
  await db.execute(
    `INSERT INTO recommendation_transitions
       (recommendation_id, user_id, from_status, to_status, occurred_at,
        trigger_name, actor, source, reason, metadata_json)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [recommendationId, userId, "active", "triggered", at, "entry", "tracker", "test", "entry reached", "{}"],
  );
}

async function outcome(
  recommendationId: number,
  type: string,
  at: number,
  rMultiple?: number,
): Promise<void> {
  await db.execute(
    `INSERT INTO recommendation_outcomes
       (recommendation_id, user_id, outcome_type, occurred_at, r_multiple, dedupe_key, source)
     VALUES (?,?,?,?,?,?,?)`,
    [recommendationId, userId, type, at, rMultiple ?? null, `${recommendationId}:${type}:${at}`, "test"],
  );
}

async function linkedTrade(recommendationId: number, createdAt: number): Promise<void> {
  const intentId = await db.insertReturningId(
    `INSERT INTO trade_intents
       (user_id, recommendation_id, symbol, side, notional, status)
     VALUES (?,?,?,?,?,?)`,
    [userId, recommendationId, "EURUSD", "buy", 1000, "executed"],
  );
  await db.execute(
    `INSERT INTO trades (user_id, intent_id, symbol, side, qty, avg_price, status, created_at)
     VALUES (?,?,?,?,?,?,?,?)`,
    [userId, intentId, "EURUSD", "buy", 0.1, 1.1, "open", createdAt],
  );
}

describe("pure adherence definitions", () => {
  it("measures late entry from first activation to first linked trade", () => {
    assert.equal(
      analytics.computeEntryDelayMs({ firstTriggeredAt: 1_000, firstTradeAt: 61_000 }),
      60_000,
    );
    // A fill recorded ahead of the activation is clamped, not negative.
    assert.equal(
      analytics.computeEntryDelayMs({ firstTriggeredAt: 5_000, firstTradeAt: 4_000 }),
      0,
    );
    assert.equal(
      analytics.computeEntryDelayMs({ firstTriggeredAt: null, firstTradeAt: 4_000 }),
      null,
    );
    assert.equal(
      analytics.computeEntryDelayMs({ firstTriggeredAt: 1_000, firstTradeAt: null }),
      null,
    );
  });

  it("counts a manual close as early exit only before any take-profit", () => {
    assert.equal(analytics.isEarlyExit({ manualCloseAt: 10, firstTakeProfitAt: null }), true);
    assert.equal(analytics.isEarlyExit({ manualCloseAt: 10, firstTakeProfitAt: 20 }), true);
    // Closing after TP1 is management, not abandonment.
    assert.equal(analytics.isEarlyExit({ manualCloseAt: 30, firstTakeProfitAt: 20 }), false);
    assert.equal(analytics.isEarlyExit({ manualCloseAt: null, firstTakeProfitAt: 20 }), false);
  });

  it("aggregates entry and stop adherence over the entries that carry data", () => {
    const entries = [
      { entryDeviation: 0.0001, stopMatchedPlan: true },
      { entryDeviation: 0.002, stopMatchedPlan: false },
      { entryDeviation: null, stopMatchedPlan: null }, // no data — not in either denominator
      { entryDeviation: -0.0003, stopMatchedPlan: true },
    ];
    // 2 of 3 measured entries within ±0.0005 of the plan price.
    assert.equal(analytics.computeEntryAdherence(entries), 2 / 3);
    // 2 of 3 measured stops matched the plan.
    assert.equal(analytics.computeStopAdherence(entries), 2 / 3);
    assert.equal(analytics.computeEntryAdherence([]), null);
    assert.equal(analytics.computeStopAdherence([]), null);
  });
});

describe("collectAdherenceFacts reads the seeded rows", () => {
  it("derives delay, early exit, and realised R per recommendation", async () => {
    const t0 = Date.now() - 60 * 60 * 1000;

    // Entered 5 minutes after the plan first became enterable; a later second
    // activation must not shrink the measured delay.
    const delayed = await recommendation();
    await triggered(delayed, t0);
    await triggered(delayed, t0 + 20 * 60 * 1000);
    await linkedTrade(delayed, t0 + 5 * 60 * 1000);

    // Closed manually before any target paid — an early exit. The realised R
    // is the LATEST outcome's r_multiple.
    const abandoned = await recommendation();
    await outcome(abandoned, "ManualClose", t0 + 10_000, -0.4);

    // Closed manually AFTER TP1 — management, not an early exit.
    const managed = await recommendation();
    await outcome(managed, "TP1", t0 + 10_000, 1.0);
    await outcome(managed, "ManualClose", t0 + 20_000, 1.6);

    const facts = await analytics.collectAdherenceFacts(userId);

    assert.equal(facts.entryDelayMsById.get(String(delayed)), 5 * 60 * 1000);
    assert.equal(facts.entryDelayMsById.has(String(abandoned)), false);

    assert.equal(facts.earlyExitIds.has(String(abandoned)), true);
    assert.equal(facts.earlyExitIds.has(String(managed)), false);

    assert.equal(facts.rMultipleById.get(String(abandoned)), -0.4);
    // Newest outcome wins.
    assert.equal(facts.rMultipleById.get(String(managed)), 1.6);
  });

  it("scopes to one operator", async () => {
    const other = await db.insertReturningId(
      "INSERT INTO users (email, password_hash, role, status) VALUES (?,?,?,?)",
      ["adherence-other@example.com", "x", "user", "active"],
    );
    const facts = await analytics.collectAdherenceFacts(other);
    assert.equal(facts.rMultipleById.size, 0);
    assert.equal(facts.earlyExitIds.size, 0);
    assert.equal(facts.entryDelayMsById.size, 0);
  });
});
