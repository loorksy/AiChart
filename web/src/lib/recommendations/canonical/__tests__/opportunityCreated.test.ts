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
 * Creation alerts used to fire through a parallel `recommendationChart` path
 * that claimed the same dedupe key but sent via raw `dispatchAlert`. The
 * contract now is: every producer goes through `announceOpportunityCreated`
 * (orchestrator, `saveRecommendation`, and the chart adapter), so a plan is
 * announced exactly once under `(recommendation_id, event, revision_no)`.
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

describe("every creation adapter shares the same dedupe", () => {
  it("suppresses the chart adapter when the lifecycle path already announced", async () => {
    const { notifyRecommendation } = await import("@/lib/recommendationChart");
    const rec = await legacyRecommendation({ legacyTrackingId: "tracked-99" });

    const announced = await notifier.announceOpportunityCreated(userId, {
      recommendationId: "tracked-99",
      symbol: rec.symbol,
      direction: "buy",
      entry: 1.1,
    });
    assert.equal(announced.delivered, 1);

    const viaChart = await notifyRecommendation(userId, rec);
    assert.equal(viaChart.delivered, false);
    assert.equal(viaChart.reason, "duplicate_creation_alert");
  });

  it("lets the chart adapter speak first — and then silences a direct announce", async () => {
    const { notifyRecommendation } = await import("@/lib/recommendationChart");
    const rec = await legacyRecommendation();

    const viaChart = await notifyRecommendation(userId, rec);
    assert.equal(viaChart.delivered, true);

    const after = await notifier.announceOpportunityCreated(userId, {
      recommendationId: String((rec as { id: number }).id),
      symbol: rec.symbol,
      direction: "buy",
      entry: 1.1,
    });
    assert.equal(after.delivered, 0);
    assert.equal(after.suppressedDuplicate, 1);
  });

  it("announces once through saveRecommendation and stays silent on retry", async () => {
    const { saveRecommendation } = await import("@/lib/store");
    const first = await saveRecommendation(userId, {
      symbol: "GBPUSD",
      action: "sell",
      confidence: 72,
      entry: 1.27,
      stop_loss: 1.275,
      take_profit: 1.26,
      plan_type: "immediate",
      source: "agent",
    });
    const second = await saveRecommendation(userId, {
      symbol: "GBPUSD",
      action: "sell",
      confidence: 72,
      entry: 1.27,
      stop_loss: 1.275,
      take_profit: 1.26,
      plan_type: "immediate",
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

  it("keeps OFF-flag rollback on the pre-lifecycle card path", async () => {
    const { clearPlatformConfigCache } = await import("@/lib/platformConfig");
    const { notifyRecommendation } = await import("@/lib/recommendationChart");
    const rec = await legacyRecommendation();
    process.env.REC_LIFECYCLE_ALERTS_V1 = "0";
    clearPlatformConfigCache();
    try {
      const announce = await notifier.announceOpportunityCreated(userId, {
        recommendationId: String((rec as { id: number }).id),
        symbol: rec.symbol,
        direction: "buy",
        entry: 1.1,
      });
      assert.equal(announce.delivered, 0);
      assert.equal(announce.suppressedSilent, 1);

      // Rollback: chart adapter uses the old card without lifecycle dedupe.
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
