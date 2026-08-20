import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { before, describe, it } from "node:test";
import { saveCompletePlan } from "@/lib/recommendations/__tests__/fixtures/completePlan";

const dir = mkdtempSync(join(tmpdir(), "aichart-opportunity-"));
process.env.DB_PATH = join(dir, "opportunity.db");
process.env.ENCRYPTION_KEY = "0".repeat(64);
process.env.APP_SECRET = "opportunity-test-secret";
delete process.env.DATABASE_URL;
delete process.env.TELEGRAM_BOT_TOKEN;

/**
 * The birth record (plan §8 C.1), against a real database.
 *
 * The platform no longer notifies anyone, but the lifecycle LEDGER still
 * admits each creation exactly once: every producer goes through
 * `announceOpportunityCreated` (orchestrator and `saveRecommendation`), so a
 * plan is recorded exactly once under `(recommendation_id, event,
 * revision_no)` and re-runs stay silent.
 */

let db: typeof import("@/lib/db");
let notifier: typeof import("@/lib/recommendations/lifecycleNotifier");
let userId = 0;

before(async () => {
  db = await import("@/lib/db");
  await db.initDb();
  notifier = await import("@/lib/recommendations/lifecycleNotifier");
  userId = await db.insertReturningId(
    "INSERT INTO users (email, password_hash, role, status) VALUES (?,?,?,?)",
    ["opportunity@example.com", "x", "user", "active"],
  );
});

describe("opportunity_created is emitted once and deduped on re-run", () => {
  it("announces a new plan and stays silent the second time", async () => {
    const first = await notifier.announceOpportunityCreated(userId, {
      recommendationId: "plan-1",
      symbol: "XAUUSD",
      direction: "buy",
      entry: 4000,
      planType: "conditional",
    });
    assert.equal(first.delivered, 1);

    const second = await notifier.announceOpportunityCreated(userId, {
      recommendationId: "plan-1",
      symbol: "XAUUSD",
      direction: "buy",
      entry: 4000,
      planType: "conditional",
    });
    assert.equal(second.delivered, 0);
    assert.equal(second.suppressedDuplicate, 1);

    // Revision 1 is part of the identity — one claimed key.
    const rows = await db.query<{ n: number }>(
      "SELECT COUNT(*) AS n FROM alert_dedupe WHERE user_id = ? AND dedupe_key = ?",
      [userId, "plan-1:1:opportunity_created"],
    );
    assert.equal(Number(rows[0]?.n), 1);
  });
});

describe("every creation producer shares the same dedupe", () => {
  it("announces once through saveRecommendation and stays silent on retry", async () => {
    const { saveRecommendation } = await import("@/lib/store");
    const first = await saveRecommendation(userId, {
      symbol: "GBPUSD",
      action: "sell",
      confidence: 72,
      entry: 1.27,
      stop_loss: 1.275,
      take_profit: 1.26,
      ...saveCompletePlan(),
      source: "agent",
    });
    const second = await saveRecommendation(userId, {
      symbol: "GBPUSD",
      action: "sell",
      confidence: 72,
      entry: 1.27,
      stop_loss: 1.275,
      take_profit: 1.26,
      ...saveCompletePlan(),
      source: "agent",
    });
    // Two rows, but each birth key is unique — one alert per recommendation id.
    const keys = await db.query<{ dedupe_key: string }>(
      `SELECT dedupe_key FROM alert_dedupe
        WHERE user_id = ? AND event_type = 'opportunity_created'
          AND dedupe_key LIKE ?`,
      [userId, `${first.id}:1:opportunity_created`],
    );
    assert.equal(keys.length, 1);
    const secondKeys = await db.query<{ dedupe_key: string }>(
      `SELECT dedupe_key FROM alert_dedupe
        WHERE user_id = ? AND event_type = 'opportunity_created'
          AND dedupe_key LIKE ?`,
      [userId, `${second.id}:1:opportunity_created`],
    );
    assert.equal(secondKeys.length, 1);

    // Re-announcing the same id adds nothing.
    const again = await notifier.announceOpportunityCreated(userId, {
      recommendationId: String(first.id),
      symbol: "GBPUSD",
      direction: "sell",
      entry: 1.27,
    });
    assert.equal(again.delivered, 0);
    assert.equal(again.suppressedDuplicate, 1);
  });

});
