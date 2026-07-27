import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { before, describe, it } from "node:test";
import { canonicalCompletePlan } from "@/lib/recommendations/__tests__/fixtures/completePlan";

const dir = mkdtempSync(join(tmpdir(), "aichart-trade-mgmt-"));
process.env.DB_PATH = join(dir, "mgmt.db");
process.env.ENCRYPTION_KEY = "0".repeat(64);
process.env.APP_SECRET = "mgmt-test-secret";
delete process.env.DATABASE_URL;

/**
 * Trade management after a position is open (plan §14), through the database.
 *
 * The broker and the operator's mode are injected; everything that matters
 * runs for real — the open-trade linkage read, the pending-intent creation,
 * the append-only trade_management revision, and the refusal to act when the
 * trade is closed or nothing actually changed.
 */

let db: typeof import("@/lib/db");
let mgmt: typeof import("@/lib/recommendations/tradeManagement");
let revisions: typeof import("@/lib/recommendations/canonical/revisions");
let repository: typeof import("@/lib/recommendations/canonical/repository");
let userId = 0;

before(async () => {
  db = await import("@/lib/db");
  await db.initDb();
  mgmt = await import("@/lib/recommendations/tradeManagement");
  revisions = await import("@/lib/recommendations/canonical/revisions");
  repository = await import("@/lib/recommendations/canonical/repository");
  userId = await db.insertReturningId(
    "INSERT INTO users (email, password_hash, role, status) VALUES (?,?,?,?)",
    ["mgmt@example.com", "x", "user", "active"],
  );
});

/** A live plan whose revision 1 carries the executed levels. */
async function livePlan(): Promise<number> {
  const rec = await repository.createCanonicalRecommendation({
    userId,
    symbol: "XAUUSD",
    market: "forex",
    timeframe: "5m",
    direction: "buy",
    entry: 4000,
    stopLoss: 3980,
    targets: [4040],
    ...canonicalCompletePlan(),
    executionState: "valid_now",
    status: "active",
    source: "test",
    engineVersion: "mgmt-test",
  });
  return rec.recommendationId;
}

/** Link an open (or closed) trade to the plan the way execution does. */
async function linkTrade(
  recommendationId: number,
  options: { status?: string; ticket?: string; broker?: string } = {},
): Promise<{ intentId: number; tradeId: number }> {
  const intentId = await db.insertReturningId(
    `INSERT INTO trade_intents
      (user_id, recommendation_id, recommendation_revision_no, authorization_source,
       symbol, side, notional, market, broker, entry, stop_loss, take_profit, status)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      userId,
      recommendationId,
      1,
      "user_approved",
      "XAUUSD",
      "buy",
      100,
      "forex",
      options.broker ?? "mt_ea",
      4000,
      3980,
      4040,
      "executed",
    ],
  );
  const tradeId = await db.insertReturningId(
    `INSERT INTO trades
      (user_id, intent_id, symbol, side, qty, quote_qty, avg_price, order_id,
       env, market, broker, status)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      userId,
      intentId,
      "XAUUSD",
      "buy",
      0.1,
      0,
      4000,
      options.ticket ?? "555001",
      "demo",
      "forex",
      options.broker ?? "mt_ea",
      options.status ?? "open",
    ],
  );
  return { intentId, tradeId };
}

/** The brain moved the stop after the fill — the revision to react to. */
async function stopMovedRevision(recommendationId: number) {
  return revisions.applyRecommendationRevision({
    userId,
    recommendationId,
    revision: {
      direction: "buy",
      planType: "immediate",
      executionState: "valid_now",
      entry: 4000,
      stopLoss: 3990,
      targets: [4040],
      reason: "إعادة تقييم: تحرك الوقف خلف القاع الجديد.",
      source: "market_update",
    },
  });
}

type QueueCall = { ticket: number; stopLoss: number; takeProfit?: number | null };

function queueSpy(calls: QueueCall[]) {
  return async (
    _userId: number,
    ticket: number,
    stopLoss: number,
    takeProfit?: number | null,
  ) => {
    calls.push({ ticket, stopLoss, takeProfit });
    return { id: 900 + calls.length } as { id: number };
  };
}

describe("advisory mode proposes and never touches the broker", () => {
  it("creates one pending approval intent and applies nothing", async () => {
    const id = await livePlan();
    await linkTrade(id);
    const revision = await stopMovedRevision(id);

    const queued: QueueCall[] = [];
    const notified: string[] = [];
    const deps = {
      isAutoAuthorized: async () => false,
      queueModify: queueSpy(queued),
      notify: async (_u: number, opts: { title: string }) => {
        notified.push(opts.title);
      },
    };

    const outcome = await mgmt.manageOpenTradeAfterRevision(
      { userId, recommendationId: id, revision },
      deps,
    );
    assert.equal(outcome.action, "approval_requested");
    assert.equal(queued.length, 0, "advisory mode must not reach the broker");
    assert.equal(notified.length, 1);

    const pending = await db.query<{ status: string; stop_loss: number; notional: number }>(
      `SELECT status, stop_loss, notional FROM trade_intents
        WHERE user_id = ? AND recommendation_id = ? AND authorization_source = 'trade_management'`,
      [userId, id],
    );
    assert.equal(pending.length, 1);
    assert.equal(pending[0]!.status, "pending");
    assert.equal(pending[0]!.stop_loss, 3990);
    assert.equal(pending[0]!.notional, 0, "a proposal is never a sized order");

    // No trade_management revision until the operator approves.
    const all = await revisions.listRevisions(userId, id);
    assert.equal(all.length, 2);
    assert.ok(all.every((r) => r.source !== "trade_management"));

    // A second sweep over the same revision must not stack a second approval.
    const again = await mgmt.manageOpenTradeAfterRevision(
      { userId, recommendationId: id, revision },
      deps,
    );
    assert.equal(again.action, "none");
    const stillOne = await db.query(
      `SELECT id FROM trade_intents
        WHERE user_id = ? AND recommendation_id = ? AND authorization_source = 'trade_management'`,
      [userId, id],
    );
    assert.equal(stillOne.length, 1);
  });

  it("approving the proposal goes to the modify path and records the sync", async () => {
    const id = await livePlan();
    await linkTrade(id, { ticket: "555002" });
    const revision = await stopMovedRevision(id);

    const queued: QueueCall[] = [];
    const created = await mgmt.manageOpenTradeAfterRevision(
      { userId, recommendationId: id, revision },
      { isAutoAuthorized: async () => false, queueModify: queueSpy(queued), notify: async () => {} },
    );
    assert.equal(created.action, "approval_requested");

    const { getIntent } = await import("@/lib/store");
    const intent = await getIntent(created.intentId!, userId);
    assert.ok(intent);

    const result = await mgmt.respondToTradeManagementIntent(userId, intent!, "approve", {
      queueModify: queueSpy(queued),
      notify: async () => {},
    });
    assert.equal(result.ok, true);
    assert.equal(result.status, "executed");
    assert.deepEqual(queued, [{ ticket: 555002, stopLoss: 3990, takeProfit: 4040 }]);

    const effective = await revisions.getEffectiveRevision(userId, id);
    assert.equal(effective?.source, "trade_management");
    assert.equal(effective?.stopLoss, 3990, "levels are copied, never invented");

    const updated = await getIntent(created.intentId!, userId);
    assert.equal(updated?.status, "executed");
  });

  it("rejecting the proposal changes nothing anywhere", async () => {
    const id = await livePlan();
    await linkTrade(id, { ticket: "555003" });
    const revision = await stopMovedRevision(id);
    const queued: QueueCall[] = [];
    const created = await mgmt.manageOpenTradeAfterRevision(
      { userId, recommendationId: id, revision },
      { isAutoAuthorized: async () => false, queueModify: queueSpy(queued), notify: async () => {} },
    );
    const { getIntent } = await import("@/lib/store");
    const intent = await getIntent(created.intentId!, userId);
    const result = await mgmt.respondToTradeManagementIntent(userId, intent!, "reject", {
      queueModify: queueSpy(queued),
      notify: async () => {},
    });
    assert.equal(result.status, "rejected");
    assert.equal(queued.length, 0);
    assert.equal((await revisions.listRevisions(userId, id)).length, 2);
  });
});

describe("auto mode syncs the broker once, under the standing grant", () => {
  it("queues exactly one modify and records a trade_management revision", async () => {
    const id = await livePlan();
    await linkTrade(id, { ticket: "555010" });
    const revision = await stopMovedRevision(id);

    const queued: QueueCall[] = [];
    const outcome = await mgmt.manageOpenTradeAfterRevision(
      { userId, recommendationId: id, revision },
      {
        isAutoAuthorized: async () => true,
        stage: () => "live",
        queueModify: queueSpy(queued),
        notify: async () => {},
      },
    );

    assert.equal(outcome.action, "auto_modified");
    assert.deepEqual(queued, [{ ticket: 555010, stopLoss: 3990, takeProfit: 4040 }]);

    // History is append-only: the seed, the brain's move, then the sync record.
    const all = await revisions.listRevisions(userId, id);
    assert.equal(all.length, 3);
    assert.deepEqual(all.map((r) => r.revisionNo), [1, 2, 3]);
    assert.equal(all[0]!.stopLoss, 3980, "revision 1 is untouched history");
    assert.equal(all[1]!.stopLoss, 3990, "the brain's revision is untouched");
    assert.equal(all[2]!.source, "trade_management");
    assert.equal(all[2]!.stopLoss, 3990, "the sync copies, never edits");
    assert.equal(
      (all[2]!.evidence as { ticket?: string }).ticket,
      "555010",
      "the sync revision explains itself: which ticket, from which revision",
    );
  });

  it("stage off means no broker touch — the proposal path applies instead", async () => {
    const id = await livePlan();
    await linkTrade(id, { ticket: "555011" });
    const revision = await stopMovedRevision(id);
    const queued: QueueCall[] = [];
    const outcome = await mgmt.manageOpenTradeAfterRevision(
      { userId, recommendationId: id, revision },
      {
        isAutoAuthorized: async () => true,
        stage: () => "off",
        queueModify: queueSpy(queued),
        notify: async () => {},
      },
    );
    assert.equal(outcome.action, "approval_requested");
    assert.equal(queued.length, 0);
  });
});

describe("nothing happens where nothing should", () => {
  it("does nothing for a plan with no linked trade", async () => {
    const id = await livePlan();
    const revision = await stopMovedRevision(id);
    const queued: QueueCall[] = [];
    const outcome = await mgmt.manageOpenTradeAfterRevision(
      { userId, recommendationId: id, revision },
      { isAutoAuthorized: async () => true, stage: () => "live", queueModify: queueSpy(queued), notify: async () => {} },
    );
    assert.equal(outcome.action, "none");
    assert.equal(queued.length, 0);
    assert.equal((await revisions.listRevisions(userId, id)).length, 2);
  });

  it("does nothing for a closed trade", async () => {
    const id = await livePlan();
    await linkTrade(id, { status: "closed", ticket: "555020" });
    const revision = await stopMovedRevision(id);
    const queued: QueueCall[] = [];
    const outcome = await mgmt.manageOpenTradeAfterRevision(
      { userId, recommendationId: id, revision },
      { isAutoAuthorized: async () => true, stage: () => "live", queueModify: queueSpy(queued), notify: async () => {} },
    );
    assert.equal(outcome.action, "none");
    assert.equal(queued.length, 0);
  });

  it("does nothing when the revision changes neither SL nor TP", async () => {
    const id = await livePlan();
    await linkTrade(id, { ticket: "555021" });
    const revision = await revisions.applyRecommendationRevision({
      userId,
      recommendationId: id,
      revision: {
        direction: "buy",
        planType: "immediate",
        executionState: "valid_now",
        entry: 4000,
        stopLoss: 3980,
        targets: [4040],
        reason: "تأكيد بلا تغيير مستويات.",
        source: "market_update",
      },
    });
    const queued: QueueCall[] = [];
    const outcome = await mgmt.manageOpenTradeAfterRevision(
      { userId, recommendationId: id, revision },
      { isAutoAuthorized: async () => true, stage: () => "live", queueModify: queueSpy(queued), notify: async () => {} },
    );
    assert.equal(outcome.action, "none");
    assert.equal(queued.length, 0);
  });

  it("never reacts to its own sync revision", async () => {
    const id = await livePlan();
    await linkTrade(id, { ticket: "555022" });
    const revision = await stopMovedRevision(id);
    const queued: QueueCall[] = [];
    const deps = {
      isAutoAuthorized: async () => true,
      stage: () => "live" as const,
      queueModify: queueSpy(queued),
      notify: async () => {},
    };
    const first = await mgmt.manageOpenTradeAfterRevision(
      { userId, recommendationId: id, revision },
      deps,
    );
    assert.equal(first.action, "auto_modified");
    const sync = await revisions.getEffectiveRevision(userId, id);
    const again = await mgmt.manageOpenTradeAfterRevision(
      { userId, recommendationId: id, revision: sync! },
      deps,
    );
    assert.equal(again.action, "none");
    assert.equal(queued.length, 1, "one condition, one broker command");
  });

  it("refuses approval when the trade closed while the request was pending", async () => {
    const id = await livePlan();
    const { tradeId } = await linkTrade(id, { ticket: "555023" });
    const revision = await stopMovedRevision(id);
    const queued: QueueCall[] = [];
    const created = await mgmt.manageOpenTradeAfterRevision(
      { userId, recommendationId: id, revision },
      { isAutoAuthorized: async () => false, queueModify: queueSpy(queued), notify: async () => {} },
    );
    assert.equal(created.action, "approval_requested");
    await db.execute("UPDATE trades SET status = 'closed' WHERE id = ?", [tradeId]);

    const { getIntent } = await import("@/lib/store");
    const intent = await getIntent(created.intentId!, userId);
    const result = await mgmt.respondToTradeManagementIntent(userId, intent!, "approve", {
      queueModify: queueSpy(queued),
      notify: async () => {},
    });
    assert.equal(result.ok, false);
    assert.equal(result.status, "failed");
    assert.equal(queued.length, 0, "a closed position gets no modify command");
  });
});
