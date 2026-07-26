/**
 * The effective-revision rules, against a real database.
 *
 * The race this closes is concrete: a conditional plan waits at 3992, deep
 * research moves it to 3988, and the auto-executor — holding an order built
 * from the first revision — is about to fill. These tests pin the outcome:
 * the stale order is refused, the new levels are what execute, and neither
 * revision is ever erased.
 */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { before, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "aichart-revisions-"));
process.env.DB_PATH = join(dir, "revisions.db");
process.env.ENCRYPTION_KEY = "0".repeat(64);
process.env.APP_SECRET = "revisions-test-secret";
delete process.env.DATABASE_URL;

let owner = 0;

before(async () => {
  const db = await import("@/lib/db");
  await db.initDb();
  owner = await db.insertReturningId(
    "INSERT INTO users (email, password_hash, role, status) VALUES (?,?,?,?)",
    ["revisions-owner@example.com", "x", "user", "active"],
  );
});

async function newRecommendation(initialRevision?: {
  evidence?: Record<string, unknown> | null;
}) {
  const lifecycle = await import("@/lib/recommendations/canonical");
  return lifecycle.createCanonicalRecommendation({
    planType: "conditional",
    executionState: "awaiting_activation",
    initialRevision,
    userId: owner,
    analysisId: `analysis-${Math.floor(performance.now() * 1000)}`,
    sessionId: "session-1",
    chatId: "chat-1",
    symbol: "XAUUSD",
    market: "forex",
    timeframe: "5m",
    direction: "buy",
    entry: 3992,
    stopLoss: 3986,
    targets: [4010],
    risk: { riskPercent: 1 },
    confidence: 70,
    strategyId: "unspecified",
    strategyVersion: "1",
    expiresAt: Date.now() + 3_600_000,
    source: "test",
    engineVersion: "revision-test",
    entryType: "buy_limit",
  });
}

describe("effective recommendation revisions", () => {
  it("moves the pointer, keeps the history, and retires the old levels", async () => {
    const { applyRecommendationRevision, listRevisions, getEffectiveRevision } = await import(
      "@/lib/recommendations/canonical/revisions"
    );
    // Creation seeds revision 1 with the plan and the evidence behind it, so a
    // revision always has a predecessor to supersede.
    const rec = await newRecommendation({
      evidence: { atr: 2, zone: [3990, 3994] },
    });

    const first = await getEffectiveRevision(owner, rec.recommendationId);
    assert.equal(first?.revisionNo, 1, "creation must seed revision 1");
    assert.equal(first?.entry, 3992);
    assert.ok(first?.evidenceHash, "the evidence bundle is fingerprinted");

    const second = await applyRecommendationRevision({
      userId: owner,
      recommendationId: rec.recommendationId,
      revision: {
        direction: "buy",
        planType: "conditional",
        executionState: "awaiting_activation",
        entry: 3988,
        stopLoss: 3984,
        targets: [4008],
        reason: "deep research moved the entry to a better price",
        source: "deep_research",
        evidence: { atr: 2.4, zone: [3986, 3990] },
      },
    });
    assert.equal(second.revisionNo, 2);

    const effective = await getEffectiveRevision(owner, rec.recommendationId);
    assert.equal(effective?.revisionNo, 2);
    assert.equal(effective?.entry, 3988);
    assert.equal(effective?.source, "deep_research");

    // Nothing was erased: both plans remain readable, in order.
    const all = await listRevisions(owner, rec.recommendationId);
    assert.deepEqual(all.map((r) => r.revisionNo), [1, 2]);
    assert.equal(all[0]!.entry, 3992);
    assert.notEqual(all[0]!.evidenceHash, all[1]!.evidenceHash);
  });

  it("refuses an order built from a superseded revision", async () => {
    const { applyRecommendationRevision, checkRevisionIsCurrent } = await import(
      "@/lib/recommendations/canonical/revisions"
    );
    const rec = await newRecommendation();

    // Revision 1 came from creation — that is what makes it stale-able.
    const beforeUpdate = await checkRevisionIsCurrent({
      userId: owner,
      recommendationId: rec.recommendationId,
      revisionNo: 1,
    });
    assert.equal(beforeUpdate.ok, true);

    await applyRecommendationRevision({
      userId: owner,
      recommendationId: rec.recommendationId,
      revision: { direction: "buy", entry: 3988, reason: "market moved", source: "market_update" },
    });

    const stale = await checkRevisionIsCurrent({
      userId: owner,
      recommendationId: rec.recommendationId,
      revisionNo: 1,
    });
    assert.equal(stale.ok, false);
    assert.equal(stale.reason, "stale_revision");
    assert.equal(stale.effectiveRevisionNo, 2);
  });

  it("treats a pre-revision recommendation as non-executable rather than current", async () => {
    const db = await import("@/lib/db");
    const { checkRevisionIsCurrent } = await import(
      "@/lib/recommendations/canonical/revisions"
    );
    // Written before revisions existed, so it has no effective revision. Built
    // with raw SQL on purpose: the creator now seeds one, and the point of this
    // test is the row that predates it.
    const legacyId = await db.insertReturningId(
      `INSERT INTO recommendations
         (user_id, symbol, market, timeframe, action, direction, confidence,
          strategy_id, strategy_version, status, status_reason, source,
          engine_version, entry, stop_loss, expires_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        owner, "XAUUSD", "forex", "5m", "buy", "buy", 70, "unspecified", "1",
        "active", "legacy row", "test", "pre-revision", 3992, 3986,
        Date.now() + 3_600_000,
      ],
    );
    const check = await checkRevisionIsCurrent({
      userId: owner,
      recommendationId: legacyId,
      revisionNo: 1,
    });
    // Not executable, and not silently treated as current either.
    assert.equal(check.ok, false);
    assert.equal(check.reason, "no_effective_revision");
  });

  it("will not revise a finished recommendation", async () => {
    const lifecycle = await import("@/lib/recommendations/canonical");
    const { applyRecommendationRevision } = await import(
      "@/lib/recommendations/canonical/revisions"
    );
    const rec = await newRecommendation();
    await lifecycle.transitionRecommendation({
      userId: owner,
      recommendationId: rec.recommendationId,
      toStatus: "sl_hit",
      trigger: "stop",
      actor: "tracker",
      source: "test",
      reason: "stop hit",
    });

    await assert.rejects(
      applyRecommendationRevision({
        userId: owner,
        recommendationId: rec.recommendationId,
        revision: { direction: "buy", entry: 3980, reason: "too late", source: "deep_research" },
      }),
      /finished recommendation cannot be revised/,
    );
  });

  it("keeps revisions append-only at the database level", async () => {
    const db = await import("@/lib/db");
    const { applyRecommendationRevision } = await import(
      "@/lib/recommendations/canonical/revisions"
    );
    const rec = await newRecommendation();
    await applyRecommendationRevision({
      userId: owner,
      recommendationId: rec.recommendationId,
      revision: { direction: "buy", entry: 3992, reason: "initial", source: "agent" },
    });
    await assert.rejects(
      db.execute("UPDATE recommendation_revisions SET entry = ? WHERE recommendation_id = ?", [
        1,
        rec.recommendationId,
      ]),
      /append-only/,
    );
  });
});
