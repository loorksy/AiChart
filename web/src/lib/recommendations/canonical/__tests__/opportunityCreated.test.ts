import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { before, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "aichart-opportunity-"));
process.env.DB_PATH = join(dir, "opportunity.db");
process.env.ENCRYPTION_KEY = "0".repeat(64);
process.env.APP_SECRET = "opportunity-test-secret";
delete process.env.DATABASE_URL;
delete process.env.TELEGRAM_BOT_TOKEN;

/**
 * The birth announcement (plan §8 C.1), against a real database.
 *
 * `opportunity_created` existed as an event type and a notifier label with no
 * producer; creation alerts went out through the legacy `recommendationChart`
 * path with no dedupe at all. These tests pin the new contract: the event is
 * emitted once through the (recommendation, event, revision) dedupe, a re-run
 * says nothing, and the legacy path claims the SAME key — so whichever path
 * speaks first, the plan is announced exactly once.
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

/** A canonical row the legacy notify path could be handed. */
async function legacyRecommendation(over: { legacyTrackingId?: string | null } = {}) {
  const id = await db.insertReturningId(
    `INSERT INTO recommendations
       (user_id, symbol, market, timeframe, action, direction, confidence,
        strategy_id, strategy_version, status, status_reason, source,
        engine_version, entry, stop_loss, take_profit, legacy_tracking_id, expires_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      userId, "EURUSD", "forex", "1h", "buy", "buy", 70,
      "unspecified", "1", "active", "test", "agent", "opportunity-test",
      1.1, 1.09, 1.12, over.legacyTrackingId ?? null,
      Date.now() + 3_600_000,
    ],
  );
  const row = await db.queryOne<Record<string, unknown>>(
    "SELECT * FROM recommendations WHERE id = ?",
    [id],
  );
  assert.ok(row);
  return row as unknown as import("@/lib/types").Recommendation;
}

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

describe("the legacy creation alert shares the same dedupe", () => {
  it("suppresses the legacy alert when the lifecycle path already announced", async () => {
    const { notifyRecommendation } = await import("@/lib/recommendationChart");
    const rec = await legacyRecommendation({ legacyTrackingId: "tracked-99" });

    // The lifecycle path announced this plan at creation (tracked reference id).
    const announced = await notifier.announceOpportunityCreated(userId, {
      recommendationId: "tracked-99",
      symbol: rec.symbol,
      direction: "buy",
      entry: 1.1,
    });
    assert.equal(announced.delivered, 1);

    // The legacy path now has nothing new to say about the same plan.
    const legacy = await notifyRecommendation(userId, rec);
    assert.equal(legacy.delivered, false);
    assert.equal(legacy.reason, "duplicate_creation_alert");
  });

  it("lets the legacy path speak first — and then silences the lifecycle event", async () => {
    const { notifyRecommendation } = await import("@/lib/recommendationChart");
    const rec = await legacyRecommendation();

    // Legacy path first (a plan created outside the orchestrator seam).
    const legacy = await notifyRecommendation(userId, rec);
    assert.notEqual(
      legacy.reason,
      "duplicate_creation_alert",
      "nothing announced this plan yet — the legacy path must proceed",
    );

    // A later lifecycle emission for the same identity stays silent.
    const after = await notifier.announceOpportunityCreated(userId, {
      recommendationId: String((rec as { id: number }).id),
      symbol: rec.symbol,
      direction: "buy",
      entry: 1.1,
    });
    assert.equal(after.delivered, 0);
    assert.equal(after.suppressedDuplicate, 1);
  });

  it("keeps OFF-flag behaviour identical to today", async () => {
    const { clearPlatformConfigCache } = await import("@/lib/platformConfig");
    const { notifyRecommendation } = await import("@/lib/recommendationChart");
    const rec = await legacyRecommendation();
    process.env.REC_LIFECYCLE_ALERTS_V1 = "0";
    clearPlatformConfigCache();
    try {
      // Lifecycle delivery is off: the event is suppressed, no key is claimed.
      const announce = await notifier.announceOpportunityCreated(userId, {
        recommendationId: String((rec as { id: number }).id),
        symbol: rec.symbol,
        direction: "buy",
        entry: 1.1,
      });
      assert.equal(announce.delivered, 0);
      assert.equal(announce.suppressedSilent, 1);

      // And the legacy path behaves exactly as it always did — no dedupe check.
      const legacy = await notifyRecommendation(userId, rec);
      assert.notEqual(legacy.reason, "duplicate_creation_alert");
      const again = await notifyRecommendation(userId, rec);
      assert.notEqual(again.reason, "duplicate_creation_alert");
    } finally {
      delete process.env.REC_LIFECYCLE_ALERTS_V1;
      clearPlatformConfigCache();
    }
  });
});
