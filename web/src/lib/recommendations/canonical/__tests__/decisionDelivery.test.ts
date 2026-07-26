import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { before, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "aichart-delivery-"));
process.env.DB_PATH = join(dir, "delivery.db");
process.env.ENCRYPTION_KEY = "0".repeat(64);
process.env.APP_SECRET = "delivery-test-secret";
delete process.env.DATABASE_URL;

/**
 * A decision has to ARRIVE, not merely be computed.
 *
 * The three-layer contract, the evidence card, and the decision trace were all
 * being produced correctly and then dropped on the floor: the fields existed on
 * the synthesizer's result, nothing copied them onto the orchestrator's output,
 * and the new plan columns were never written. Everything looked right in the
 * unit tests and the operator saw none of it.
 *
 * Schema-shape assertions cannot catch that — the contract was satisfied at the
 * point of production. These tests follow the values all the way to storage.
 */

let db: typeof import("@/lib/db");
let store: typeof import("@/lib/recommendations/recommendationStore");
let revisions: typeof import("@/lib/recommendations/canonical/revisions");
let userId = 0;

before(async () => {
  db = await import("@/lib/db");
  await db.initDb();
  store = await import("@/lib/recommendations/recommendationStore");
  revisions = await import("@/lib/recommendations/canonical/revisions");
  userId = await db.insertReturningId(
    "INSERT INTO users (email, password_hash, role, status) VALUES (?,?,?,?)",
    ["delivery@example.com", "x", "user", "active"],
  );
});

async function planRow(trackingId: string) {
  const rows = await db.query<Record<string, unknown>>(
    `SELECT id, plan_type, execution_state, statistical_support, effective_revision_no
       FROM recommendations WHERE legacy_tracking_id = ? AND user_id = ?`,
    [trackingId, userId],
  );
  return rows[0];
}

function create(id: string, over: Record<string, unknown> = {}) {
  return store.createTrackedRecommendation({
    id,
    userId,
    chatId: "chat-1",
    analysisId: "an-1",
    symbol: "EURUSD",
    interval: "5m",
    direction: "buy",
    entryType: "pending",
    entry: 1.1,
    stopLoss: 1.09,
    targets: [1.12, 1.14],
    status: "pending_entry",
    outcome: "pending",
    createdAt: Date.now(),
    createdCandleTime: Date.now(),
    expiresAt: Date.now() + 3_600_000,
    planType: "conditional",
    executionState: "awaiting_activation",
    statisticalSupport: "unavailable",
    entryLow: 1.098,
    entryHigh: 1.102,
    triggerCondition: "إغلاق شمعة فوق 1.1005",
    invalidationRule: "إغلاق شمعة تحت 1.09",
    alternativeScenario: "كسر 1.09 يقلب المشهد إلى بيع",
    validityCandles: 8,
    ...over,
  } as Parameters<typeof store.createTrackedRecommendation>[0]);
}

describe("the three layers reach storage", () => {
  it("writes plan type, execution state, and the support grade", async () => {
    await create("rec-layers");
    const row = await planRow("rec-layers");
    assert.ok(row, "the recommendation was not stored");
    // Each of these was NULL before: computed in memory, never persisted.
    assert.equal(row.plan_type, "conditional");
    assert.equal(row.execution_state, "awaiting_activation");
    assert.equal(row.statistical_support, "unavailable");
  });

  it("gives every new recommendation an effective revision", async () => {
    await create("rec-seeded");
    const row = await planRow("rec-seeded");
    assert.equal(
      row!.effective_revision_no,
      1,
      "without an effective revision nothing can revise or auto-execute this plan",
    );

    const list = await revisions.listRevisions(userId, Number(row!.id));
    assert.equal(list.length, 1);
    assert.equal(list[0]!.revisionNo, 1);
    assert.equal(list[0]!.source, "agent");
    assert.equal(list[0]!.planType, "conditional");
    assert.equal(list[0]!.executionState, "awaiting_activation");
  });

  it("carries the plan's own conditions into revision 1", async () => {
    await create("rec-conditions");
    const row = await planRow("rec-conditions");
    const effective = await revisions.getEffectiveRevision(userId, Number(row!.id));
    assert.ok(effective, "no effective revision to read");
    // The tracker needs the activation condition; without it a conditional plan
    // has nothing to wait for and can never legitimately activate.
    assert.equal(effective.activationCondition, "إغلاق شمعة فوق 1.1005");
    assert.equal(effective.invalidationRule, "إغلاق شمعة تحت 1.09");
    assert.equal(effective.alternativeScenario, "كسر 1.09 يقلب المشهد إلى بيع");
    assert.equal(effective.validityCandles, 8);
    assert.equal(effective.entryLow, 1.098);
    assert.equal(effective.entryHigh, 1.102);
  });

  it("stores the evidence snapshot and the decision trace with the revision", async () => {
    await create("rec-explained", {
      decisionTrace: {
        hypotheses: [{ scenario: "ارتداد من الطلب", supporting: ["هيكل صاعد"], opposing: [] }],
        chosenBecause: "الطلب صمد مرتين",
        planTypeBecause: "السعر بعيد عن المنطقة",
      },
      evidence: {
        evidenceDimensions: [
          { key: "historical_cases", grade: "unavailable", detail: "لا حالات مشابهة" },
        ],
      },
    });
    const row = await planRow("rec-explained");
    const effective = await revisions.getEffectiveRevision(userId, Number(row!.id));
    assert.ok(effective);
    assert.ok(
      effective.evidenceHash,
      "a revision with evidence must carry its fingerprint, or two revisions cannot be compared",
    );
    assert.equal(
      (effective.decisionTrace as { chosenBecause?: string }).chosenBecause,
      "الطلب صمد مرتين",
    );
    assert.ok(
      Array.isArray((effective.evidence as { evidenceDimensions?: unknown }).evidenceDimensions),
      "the evidence card must survive into the snapshot",
    );
  });

  it("a seeded revision can be superseded, and the old one goes stale", async () => {
    await create("rec-revisable");
    const row = await planRow("rec-revisable");
    const id = Number(row!.id);

    const second = await revisions.applyRecommendationRevision({
      userId,
      recommendationId: id,
      revision: {
        direction: "buy",
        planType: "immediate",
        executionState: "valid_now",
        entry: 1.101,
        stopLoss: 1.0905,
        targets: [1.121],
        reason: "price reached the zone",
        source: "market_update",
      },
    });
    assert.equal(second.revisionNo, 2, "the seed must be revision 1 so this is 2");

    // The whole point of seeding: revision 1 now has something to go stale
    // against, which is what the compare-and-swap on execution relies on.
    const stale = await revisions.checkRevisionIsCurrent({
      userId,
      recommendationId: id,
      revisionNo: 1,
    });
    assert.equal(stale.ok, false);
    assert.equal(stale.reason, "stale_revision");

    const current = await revisions.checkRevisionIsCurrent({
      userId,
      recommendationId: id,
      revisionNo: 2,
    });
    assert.equal(current.ok, true);
  });

  it("does not make a legacy wait row executable", async () => {
    // A legacy row carries no plan. Seeding it a revision would hand it an
    // effective revision and make it eligible for auto-execution.
    const id = await db.insertReturningId(
      `INSERT INTO recommendations
         (user_id, symbol, market, timeframe, action, direction, confidence,
          strategy_id, strategy_version, status, status_reason, source, engine_version,
          expires_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        userId, "BTCUSDT", "crypto", "1h", "wait", "wait", 0, "legacy", "1",
        "active", "legacy", "web", "legacy", Date.now() + 3_600_000,
      ],
    );
    const rows = await db.query<{ effective_revision_no: number | null }>(
      "SELECT effective_revision_no FROM recommendations WHERE id = ?",
      [id],
    );
    assert.equal(rows[0]!.effective_revision_no, null);
    const list = await revisions.listRevisions(userId, id);
    assert.deepEqual(list, [], "a legacy wait row must never gain a revision");
  });
});
