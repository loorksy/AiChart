import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { before, describe, it } from "node:test";
import Database from "better-sqlite3";

const dir = mkdtempSync(join(tmpdir(), "aichart-reeval-migration-"));
const path = join(dir, "legacy.db");
process.env.DB_PATH = path;
process.env.ENCRYPTION_KEY = "0".repeat(64);
process.env.APP_SECRET = "reeval-migration-test-secret";
delete process.env.DATABASE_URL;

// The exact pre-queue shape: CREATE TABLE IF NOT EXISTS will leave it untouched,
// so initDb must add the columns before it creates the pending-claim index.
const legacy = new Database(path);
legacy.exec(`
  CREATE TABLE recommendation_reevaluations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    recommendation_id TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    symbol TEXT NOT NULL,
    reason TEXT NOT NULL,
    detail TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL,
    revision_no INTEGER,
    outcome TEXT NOT NULL,
    raised_at INTEGER NOT NULL,
    dedupe_key TEXT NOT NULL,
    evidence_hash TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (recommendation_id, dedupe_key)
  );
  INSERT INTO recommendation_reevaluations
    (recommendation_id, user_id, symbol, reason, detail, source, revision_no,
     outcome, raised_at, dedupe_key)
  VALUES ('legacy-rec', 1, 'EURUSD', 'spread_widened', 'old claim',
          'tracker', 1, 'cycle_requested', 1234, '1:spread_widened');
`);
legacy.close();

let db: typeof import("@/lib/db");

before(async () => {
  db = await import("@/lib/db");
  await db.initDb();
});

describe("re-evaluation queue migration", () => {
  it("adds resumable columns and closes only the historical claim", async () => {
    const columns = await db.query<{ name: string }>(
      "PRAGMA table_info(recommendation_reevaluations)",
    );
    const names = new Set(columns.map((column) => column.name));
    for (const required of [
      "trigger_payload_json",
      "evidence_json",
      "decision_trace_json",
      "claimed_at",
      "completed_at",
    ]) {
      assert.ok(names.has(required), `missing migrated column ${required}`);
    }

    const rows = await db.query<{
      claimed_at: number | null;
      completed_at: number | null;
    }>(
      `SELECT claimed_at, completed_at
         FROM recommendation_reevaluations
        WHERE recommendation_id = 'legacy-rec'`,
    );
    assert.equal(rows[0]?.claimed_at, null);
    assert.equal(Number(rows[0]?.completed_at), 1234);

    const indexes = await db.query<{ name: string }>(
      "PRAGMA index_list(recommendation_reevaluations)",
    );
    assert.ok(
      indexes.some(
        (index) => index.name === "idx_recommendation_reevaluations_pending",
      ),
    );
  });
});
