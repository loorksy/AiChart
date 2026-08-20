import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { before, describe, it } from "node:test";
import { gatedCompletePlan } from "@/lib/recommendations/__tests__/fixtures/completePlan";

const dir = mkdtempSync(join(tmpdir(), "aichart-personal-notes-"));
process.env.DB_PATH = join(dir, "notes.db");
process.env.ENCRYPTION_KEY = "0".repeat(64);
process.env.APP_SECRET = "notes-test-secret";
delete process.env.DATABASE_URL;

/**
 * Personal notes (plan §15), through the database.
 *
 * The claims worth guarding: a note exists only past the learning pipeline's
 * sample floor, its session and R come from real rows (creation time and
 * recorded r_multiple, never estimates), it lands in the bounded lessons
 * block as one more observation, and it persists through the existing lesson
 * storage without inventing a table.
 */

let db: typeof import("@/lib/db");
let notes: typeof import("@/lib/recommendations/personalNotes");
let learning: typeof import("@/lib/agent/learningLoop");
let repository: typeof import("@/lib/recommendations/canonical/repository");
let userId = 0;

/** 08:00 UTC — inside the London window of performanceJournal.sessionOf. */
const LONDON_CREATED_AT = Date.UTC(2026, 0, 5, 8, 0, 0);

before(async () => {
  db = await import("@/lib/db");
  await db.initDb();
  notes = await import("@/lib/recommendations/personalNotes");
  learning = await import("@/lib/agent/learningLoop");
  repository = await import("@/lib/recommendations/canonical/repository");
  userId = await db.insertReturningId(
    "INSERT INTO users (email, password_hash, role, status) VALUES (?,?,?,?)",
    ["notes@example.com", "x", "user", "active"],
  );
  // Lifecycle tests model paying subscribers — the 3-recommendation trial
  // cap is covered by the subscription suite, not here.
  await db.execute(
    "INSERT INTO user_entitlements (user_id, plan_status) VALUES (?, 'active')",
    [userId],
  );
});

/**
 * A resolved plan: created at a controlled session time, with the tracker's
 * outcome row carrying a REAL r_multiple.
 */
async function resolvedPlan(input: {
  symbol: string;
  outcome: "TP1" | "SL";
  rMultiple: number;
  createdAt?: number;
}): Promise<number> {
  const rec = await repository.createCanonicalRecommendation({
    userId,
    symbol: input.symbol,
    market: "forex",
    timeframe: "5m",
    direction: "buy",
    entry: 4000,
    stopLoss: 3980,
    targets: [4040],
    ...(await gatedCompletePlan(userId, { symbol: input.symbol })),
    executionState: "valid_now",
    status: "active",
    source: "test",
    engineVersion: "notes-test",
  });
  // Pin the creation time so the derived session is a controlled fact.
  await db.execute("UPDATE recommendations SET created_at = ? WHERE id = ?", [
    input.createdAt ?? LONDON_CREATED_AT,
    rec.recommendationId,
  ]);
  await db.execute(
    `INSERT INTO recommendation_outcomes
      (recommendation_id, user_id, outcome_type, r_multiple, occurred_at,
       source, evidence_json, dedupe_key)
     VALUES (?,?,?,?,?,?,?,?)`,
    [
      rec.recommendationId,
      userId,
      input.outcome,
      input.rMultiple,
      (input.createdAt ?? LONDON_CREATED_AT) + 60 * 60 * 1000,
      "tracker",
      "{}",
      `${input.outcome}:${rec.recommendationId}`,
    ],
  );
  return rec.recommendationId;
}

describe("a sufficient sample produces a note with the real session and R", () => {
  it("derives, persists, and reports the observation", async () => {
    // Five London losses at -1R: the pipeline's exact minimum sample.
    for (let i = 0; i < 5; i += 1) {
      await resolvedPlan({ symbol: "XAUUSD", outcome: "SL", rMultiple: -1 });
    }

    const derived = await notes.generatePersonalNotes(userId, "XAUUSD");
    assert.equal(derived.length, 1);
    const note = derived[0]!;
    assert.equal(note.session, "london", "the ACTUAL session from creation time");
    assert.equal(note.sampleSize, 5);
    assert.equal(note.losses, 5);
    assert.equal(note.averageR, -1, "the recorded r_multiple, not an estimate");
    assert.match(note.text, /london/);
    assert.match(note.text, /-1\.00R/);

    // Persisted through the EXISTING lesson storage, past the existing gates.
    const stored = await db.query<{
      strategy_id: string;
      reason: string;
      confidence: number;
      sample_size: number;
    }>(
      `SELECT strategy_id, reason, confidence, sample_size
         FROM trade_lesson_candidates WHERE user_id = ? AND strategy_id = 'personal_notes'`,
      [userId],
    );
    assert.equal(stored.length, 1);
    assert.equal(stored[0]!.reason, note.text);
    assert.ok(stored[0]!.confidence >= notes.PERSONAL_NOTE_MIN_SHARE);
    assert.equal(stored[0]!.sample_size, 5);

    // Re-deriving updates the fingerprinted row instead of stacking a copy.
    await notes.generatePersonalNotes(userId, "XAUUSD");
    const still = await db.query(
      "SELECT id FROM trade_lesson_candidates WHERE user_id = ? AND strategy_id = 'personal_notes'",
      [userId],
    );
    assert.equal(still.length, 1);
  });

  it("feeds the note into the lessons block output", async () => {
    const outcomes = await notes.loadRealizedOutcomes(userId, "XAUUSD");
    assert.ok(outcomes.length >= 5);
    const summary = learning.summarizeTradeLessons({ symbol: "XAUUSD", outcomes });
    assert.equal(summary.insufficient, false);

    const derived = notes.derivePersonalNotes({ symbol: "XAUUSD", outcomes });
    const rendered = learning.renderLessonsForPrompt(
      notes.feedLessonsSummary(summary, derived),
    );
    assert.ok(rendered);
    assert.ok(
      rendered!.includes(derived[0]!.text),
      "the personal note must appear in the lessons block",
    );
    // Evidence framing, never a veto: the block's own preamble still leads.
    assert.match(rendered!, /سياق تزنه/);
  });

  it("caps how many notes the block gains", async () => {
    const summary = learning.summarizeTradeLessons({
      symbol: "XAUUSD",
      outcomes: await notes.loadRealizedOutcomes(userId, "XAUUSD"),
    });
    const beforeCount = summary.notes.length;
    const fabricated = Array.from({ length: 6 }, (_, i) => ({
      symbol: "XAUUSD",
      session: "london" as const,
      sampleSize: 5,
      wins: 5,
      losses: 0,
      share: 1,
      averageR: 2,
      text: `note ${i}`,
      fingerprint: `personal_note:test:${i}`,
    }));
    notes.feedLessonsSummary(summary, fabricated);
    assert.equal(
      summary.notes.length,
      beforeCount + notes.MAX_PERSONAL_NOTES,
      "the bounded block stays bounded",
    );
  });
});

describe("below the thresholds there is nothing — a count is not a pattern", () => {
  it("produces nothing under the sample floor", async () => {
    for (let i = 0; i < notes.PERSONAL_NOTE_MIN_SAMPLE - 1; i += 1) {
      await resolvedPlan({ symbol: "EURUSD", outcome: "SL", rMultiple: -1 });
    }
    const derived = await notes.generatePersonalNotes(userId, "EURUSD");
    assert.deepEqual(derived, []);
    const stored = await db.query(
      `SELECT id FROM trade_lesson_candidates
        WHERE user_id = ? AND strategy_id = 'personal_notes' AND affected_symbols_json LIKE '%EURUSD%'`,
      [userId],
    );
    assert.equal(stored.length, 0, "nothing persisted below the floor");
  });

  it("produces nothing when no session is one-sided past the confidence gate", async () => {
    // Six London results split 3/3: sample enough, conviction absent.
    for (let i = 0; i < 3; i += 1) {
      await resolvedPlan({ symbol: "GBPUSD", outcome: "TP1", rMultiple: 2 });
      await resolvedPlan({ symbol: "GBPUSD", outcome: "SL", rMultiple: -1 });
    }
    const derived = await notes.generatePersonalNotes(userId, "GBPUSD");
    assert.deepEqual(derived, []);
  });

  it("an insufficient lessons summary is never widened by notes", async () => {
    const summary = learning.summarizeTradeLessons({ symbol: "USDJPY", outcomes: [] });
    const fed = notes.feedLessonsSummary(summary, [
      {
        symbol: "USDJPY",
        session: "asia",
        sampleSize: 5,
        wins: 5,
        losses: 0,
        share: 1,
        averageR: 1,
        text: "should not appear",
        fingerprint: "personal_note:usdjpy:asia:success",
      },
    ]);
    assert.deepEqual(fed.notes, [], "the block's own insufficiency rule wins");
  });
});
