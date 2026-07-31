import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { before, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "aichart-journal-"));
process.env.DB_PATH = join(dir, "journal.db");
process.env.ENCRYPTION_KEY = "0".repeat(64);
process.env.APP_SECRET = "journal-test-secret";
delete process.env.DATABASE_URL;

/**
 * The performance journal, against a real database.
 *
 * The unit tests for `summarizeJournal` were correct and passed throughout, while
 * the QUERY behind them read `tracked_recommendations` — the retired legacy table
 * that nothing writes to, whose TEXT id could never match
 * `trade_intents.recommendation_id` (an INTEGER canonical id). Every entry
 * therefore came back "ignored" and the followed-vs-ignored comparison, the whole
 * point of the journal, was permanently empty.
 *
 * A pure function tested in isolation cannot catch that. These tests go through
 * the query.
 */

let db: typeof import("@/lib/db");
let journal: typeof import("@/lib/recommendations/performanceJournal");
let userId = 0;

before(async () => {
  db = await import("@/lib/db");
  await db.initDb();
  journal = await import("@/lib/recommendations/performanceJournal");
  userId = await db.insertReturningId(
    "INSERT INTO users (email, password_hash, role, status) VALUES (?,?,?,?)",
    ["journal@example.com", "x", "user", "active"],
  );
});

async function recommendation(over: {
  status?: string;
  direction?: string;
  entry?: number;
  stopLoss?: number;
  planType?: string;
} = {}): Promise<number> {
  return db.insertReturningId(
    `INSERT INTO recommendations
       (user_id, symbol, market, timeframe, action, direction, confidence,
        strategy_id, strategy_version, status, status_reason, source,
        engine_version, entry, stop_loss, plan_type, expires_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      userId, "EURUSD", "forex", "5m",
      over.direction ?? "buy", over.direction ?? "buy", 70,
      "unspecified", "1", over.status ?? "active", "test", "test", "journal-test",
      over.entry ?? 1.1, over.stopLoss ?? 1.09, over.planType ?? "immediate",
      Date.now() + 3_600_000,
    ],
  );
}

async function outcome(recommendationId: number, type: string): Promise<void> {
  await db.execute(
    `INSERT INTO recommendation_outcomes
       (recommendation_id, user_id, outcome_type, occurred_at, dedupe_key, source)
     VALUES (?,?,?,?,?,?)`,
    [recommendationId, userId, type, Date.now(), `${recommendationId}:${type}`, "test"],
  );
}

/** An intent plus a filled trade — i.e. the operator (or auto mode) acted. */
async function filledTrade(
  recommendationId: number,
  opts: { authorizationSource?: string; stopLoss?: number; avgPrice?: number } = {},
): Promise<void> {
  const intentId = await db.insertReturningId(
    `INSERT INTO trade_intents
       (user_id, recommendation_id, symbol, side, notional, status, stop_loss,
        authorization_source)
     VALUES (?,?,?,?,?,?,?,?)`,
    [
      userId, recommendationId, "EURUSD", "buy", 1000, "executed",
      opts.stopLoss ?? 1.09, opts.authorizationSource ?? "user_approved",
    ],
  );
  await db.execute(
    `INSERT INTO trades (user_id, intent_id, symbol, side, qty, avg_price, status)
     VALUES (?,?,?,?,?,?,?)`,
    [userId, intentId, "EURUSD", "buy", 0.1, opts.avgPrice ?? 1.1, "open"],
  );
}

describe("performance journal query", () => {
  it("counts a recommendation with a filled trade as followed", async () => {
    const id = await recommendation({ status: "tp1_hit" });
    await outcome(id, "TP1");
    await filledTrade(id);

    const { entries, summary } = await journal.buildPerformanceJournal({ userId });
    const entry = entries.find((e) => e.recommendationId === String(id));
    assert.ok(entry, "the recommendation did not appear in the journal at all");
    // This is the assertion the old query could never satisfy.
    assert.equal(entry.followState, "followed_manual");
    assert.equal(entry.outcome, "win_tp1");
    assert.equal(summary.followed.count, 1);
    assert.equal(summary.followed.wins, 1);
    assert.equal(summary.ignored.count, 0);
  });

  it("counts a resolved recommendation with no trade as ignored", async () => {
    const id = await recommendation({ status: "sl_hit" });
    await outcome(id, "SL");

    const { entries } = await journal.buildPerformanceJournal({ userId });
    const entry = entries.find((e) => e.recommendationId === String(id));
    assert.ok(entry);
    // The absence of a trade IS the signal — the outcome is still known because
    // the tracker evaluates a plan whether or not it was taken.
    assert.equal(entry.followState, "ignored");
    assert.equal(entry.outcome, "loss");
  });

  it("tells automatic execution apart from an explicit approval", async () => {
    const auto = await recommendation({ status: "tp1_hit" });
    await outcome(auto, "TP1");
    await filledTrade(auto, { authorizationSource: "standing_auto" });

    const { entries } = await journal.buildPerformanceJournal({ userId });
    const entry = entries.find((e) => e.recommendationId === String(auto));
    assert.equal(entry?.followState, "followed_auto");
  });

  it("counts a plan once even when it raised several intents", async () => {
    const id = await recommendation({ status: "tp2_hit" });
    await outcome(id, "TP2");
    await filledTrade(id);
    await filledTrade(id); // a second attempt on the same plan

    const { entries } = await journal.buildPerformanceJournal({ userId });
    const matching = entries.filter((e) => e.recommendationId === String(id));
    assert.equal(
      matching.length,
      1,
      "a plan with two intents was counted twice, inflating every summary number",
    );
    assert.equal(matching[0]!.followState, "followed_manual");
  });

  it("measures entry deviation relative to the plan price", async () => {
    const id = await recommendation({ status: "tp1_hit", entry: 1.1 });
    await outcome(id, "TP1");
    // Filled 11 pips above a 1.1000 plan entry: 0.1% away.
    await filledTrade(id, { avgPrice: 1.1011 });

    const { entries } = await journal.buildPerformanceJournal({ userId });
    const entry = entries.find((e) => e.recommendationId === String(id));
    assert.ok(entry?.entryDeviation != null);
    // A fraction, not a raw price distance — so one threshold works on EURUSD
    // and on XAUUSD alike.
    assert.ok(
      Math.abs(entry.entryDeviation - 0.001) < 1e-4,
      `expected ~0.001 relative deviation, got ${entry.entryDeviation}`,
    );
  });

  it("reports whether the executed stop matched the plan's", async () => {
    const kept = await recommendation({ status: "tp1_hit", stopLoss: 1.09 });
    await outcome(kept, "TP1");
    await filledTrade(kept, { stopLoss: 1.09 });

    const moved = await recommendation({ status: "sl_hit", stopLoss: 1.09 });
    await outcome(moved, "SL");
    await filledTrade(moved, { stopLoss: 1.05 });

    const { entries } = await journal.buildPerformanceJournal({ userId });
    assert.equal(entries.find((e) => e.recommendationId === String(kept))?.stopMatchedPlan, true);
    assert.equal(entries.find((e) => e.recommendationId === String(moved))?.stopMatchedPlan, false);
  });

  it("carries the plan type through", async () => {
    const id = await recommendation({ status: "expired", planType: "conditional" });
    const { entries } = await journal.buildPerformanceJournal({ userId });
    assert.equal(entries.find((e) => e.recommendationId === String(id))?.planType, "conditional");
  });

  it("leaves legacy wait rows out of the journal entirely", async () => {
    const id = await recommendation({ direction: "wait", status: "expired" });
    const { entries } = await journal.buildPerformanceJournal({ userId });
    assert.equal(
      entries.find((e) => e.recommendationId === String(id)),
      undefined,
      "a wait row has no plan to have been followed or ignored",
    );
  });

  it("scopes to one operator", async () => {
    const other = await db.insertReturningId(
      "INSERT INTO users (email, password_hash, role, status) VALUES (?,?,?,?)",
      ["journal-other@example.com", "x", "user", "active"],
    );
    const { entries } = await journal.buildPerformanceJournal({ userId: other });
    assert.deepEqual(entries, []);
  });
});
