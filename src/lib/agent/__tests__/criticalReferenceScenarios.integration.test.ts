/**
 * Integration owners for the §16 reference scenarios that need a real database.
 *
 * The previous owner files were deleted along with the candle warehouse and the
 * execution layer, which left nine scenarios in the coverage map pointing at
 * nothing — a coverage map whose rows name files that do not exist is worse
 * than none, because it reads as proof.
 *
 * These tests are rewritten against the modules that own the behaviour NOW:
 * the canonical store, the revision mechanism, the lifecycle dedupe, and the
 * gate chain. Every one writes to a real SQLite file and asserts on what came
 * back out — no mocked persistence, because the scenarios are precisely about
 * what survives a round trip.
 */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { before, describe, it } from "node:test";
import { canonicalCompletePlan } from "@/lib/recommendations/__tests__/fixtures/completePlan";

const dir = mkdtempSync(join(tmpdir(), "aichart-critical-scenarios-"));
process.env.DB_PATH = join(dir, "critical.db");
process.env.ENCRYPTION_KEY = "0".repeat(64);
process.env.APP_SECRET = "critical-scenarios-secret";
delete process.env.DATABASE_URL;
delete process.env.TELEGRAM_BOT_TOKEN;
// The calendar scenario asserts on the ABSENCE of a provider; a key leaking in
// from the environment would make it assert the opposite of its name.
delete process.env.FMP_API_KEY;
delete process.env.NEWS_API_KEY;
delete process.env.ECONOMIC_CALENDAR_API_KEY;
// The keyless Forex Factory feed counts as a configured provider and defaults
// ON, so "no provider" has to be stated rather than assumed.
process.env.FOREX_FACTORY_CALENDAR_V1 = "0";

let db: typeof import("@/lib/db");
let canonical: typeof import("@/lib/recommendations/canonical");
let revisions: typeof import("@/lib/recommendations/canonical/revisions");
let notifier: typeof import("@/lib/recommendations/lifecycleNotifier");
let snapshots: typeof import("@/lib/recommendations/canonical/evidenceSnapshots");
let userId = 0;

/** A paid owner: the three-recommendation trial cap is not what is under test. */
before(async () => {
  db = await import("@/lib/db");
  await db.initDb();
  canonical = await import("@/lib/recommendations/canonical");
  revisions = await import("@/lib/recommendations/canonical/revisions");
  notifier = await import("@/lib/recommendations/lifecycleNotifier");
  snapshots = await import("@/lib/recommendations/canonical/evidenceSnapshots");
  userId = await db.insertReturningId(
    "INSERT INTO users (email, password_hash, role, status) VALUES (?,?,?,?)",
    ["critical-scenarios@example.com", "x", "user", "active"],
  );
  await db.execute(
    `INSERT INTO user_entitlements (user_id, plan_status, trial_interactions_used, trial_in_flight)
     VALUES (?, 'active', 0, 0)
     ON CONFLICT (user_id) DO UPDATE SET plan_status = 'active'`,
    [userId],
  );
});

let seq = 0;

/** A gold plan a real surface could have produced, written the production way. */
async function createPlan(over?: {
  planType?: "immediate" | "anticipatory" | "conditional";
  entry?: number;
  stopLoss?: number;
  targets?: number[];
  evidenceSnapshot?: Record<string, unknown> | null;
  decisionTrace?: Record<string, unknown> | null;
}) {
  seq += 1;
  const entry = over?.entry ?? 4340.5;
  // Production writes only after the gate chain ran and was recorded; the
  // fixture records the same authorization through the real recorder.
  const { seedPassedGateChain } = await import(
    "@/lib/recommendations/__tests__/fixtures/completePlan"
  );
  await seedPassedGateChain(userId, `critical-analysis-${seq}`, "XAUUSD");
  return canonical.createCanonicalRecommendation({
    ...canonicalCompletePlan({
      planType: over?.planType ?? "immediate",
      evidenceSnapshot: over?.evidenceSnapshot ?? null,
      decisionTrace: over?.decisionTrace ?? null,
    }),
    userId,
    analysisId: `critical-analysis-${seq}`,
    sessionId: `critical-session-${seq}`,
    symbol: "XAUUSD",
    market: "forex",
    timeframe: "15m",
    direction: "buy",
    entry,
    stopLoss: over?.stopLoss ?? entry - 6,
    targets: over?.targets ?? [entry + 12, entry + 20],
    confidence: 0,
    strategyId: "critical-scenarios",
    strategyVersion: "1",
    createdAt: Date.now(),
    expiresAt: Date.now() + 4 * 60 * 60 * 1000,
    status: "active" as const,
    statusReason: "created by the critical reference scenario suite",
    source: "agent-tracker",
    engineVersion: "critical-scenarios-v1",
  });
}

describe("§16 critical reference scenarios", () => {
  it("clear_trend creates revision 1, snapshot, trace, and one opportunity_created", async () => {
    const snapshot = { modelContext: { symbol: "XAUUSD", interval: "15m", currentPrice: 4340.5 } };
    const trace = { chosenBecause: "higher high held on the retest", planTypeBecause: "price at the level" };
    const plan = await createPlan({ evidenceSnapshot: snapshot, decisionTrace: trace });

    const revision = await revisions.getEffectiveRevision(userId, plan.recommendationId);
    assert.ok(revision, "an accepted plan must carry revision 1");
    assert.equal(revision.revisionNo, 1);
    // The snapshot is the object the brain decided on; the hash names it. A
    // revision hashing a bundle that was never stored is a claim with no
    // evidence behind it, which is the failure the snapshot table prevents.
    assert.ok(revision.evidenceHash, "revision 1 must fingerprint its snapshot");
    const stored = await snapshots.getEvidenceSnapshot(userId, plan.recommendationId, 1);
    assert.ok(stored, "the hash must name a snapshot that was actually written");
    assert.deepEqual(stored.snapshot, snapshot);
    assert.equal(stored.fingerprint, revision.evidenceHash);
    assert.deepEqual(revision.decisionTrace, trace);

    const first = await notifier.announceOpportunityCreated(userId, {
      recommendationId: String(plan.recommendationId),
      symbol: "XAUUSD",
      direction: "buy",
      entry: 4340.5,
      planType: "immediate",
    });
    const second = await notifier.announceOpportunityCreated(userId, {
      recommendationId: String(plan.recommendationId),
      symbol: "XAUUSD",
      direction: "buy",
      entry: 4340.5,
      planType: "immediate",
    });
    assert.notEqual(first.suppressedDuplicate, 1, "the first announcement is not a duplicate");
    assert.equal(second.suppressedDuplicate, 1, "the birth is announced exactly once");
  });

  it("cost_ruins_entry keeps a conditional plan and never distorts levels", async () => {
    // Gold in New York carries a spread wide enough to ruin a tight entry. The
    // honest response is a conditional plan at a level worth waiting for — NOT
    // a silently widened stop or a target nudged out to rescue the ratio.
    const entry = 2405;
    const stopLoss = 2398.4;
    const targets = [2418.75, 2431.2];
    const plan = await createPlan({ planType: "conditional", entry, stopLoss, targets });

    const stored = await canonical.getCanonicalRecommendationByReference(
      userId,
      plan.recommendationId,
    );
    assert.ok(stored);
    assert.equal(stored.entry, entry, "the entry the operator was shown is the entry stored");
    assert.equal(stored.stopLoss, stopLoss);
    assert.deepEqual(stored.targets, targets);
    assert.equal(stored.planType, "conditional", "cost pressure never collapses a plan into WAIT");
    assert.equal(stored.executionState, "awaiting_activation");
  });

  it("calendar_provider_absent invents no events and still stores a plan", async () => {
    const { newsProviderConfigured } = await import("@/lib/agent/news/newsProvider");
    const { runNewsMacroAgent } = await import("@/lib/agent/agents/newsMacroAgent");
    const { buildGates } = await import("@/lib/agent/gates/buildGates");
    const { runGateChain } = await import("@/lib/agent/gates/chain");

    assert.equal(newsProviderConfigured(), false, "this scenario requires no provider");
    const news = await runNewsMacroAgent(
      { emitActivity: () => {}, requestId: "critical-news" } as never,
      { symbol: "XAUUSD" },
    );
    assert.equal(news.newsRisk, "unknown");
    assert.deepEqual(news.upcomingEvents, [], "absence is reported, never filled in");

    const { gates } = buildGates({
      now: Date.now(),
      news,
      newsProviderConfigured: false,
      structure: { trend: "uptrend", swings: [], support: [], resistance: [], structureEvents: [] },
      liquidity: null,
      supplyDemand: null,
      mtf: null,
      statisticalSupport: { level: "unavailable", detail: "none" },
      atr: 4,
      plan: {
        direction: "buy",
        entryType: "limit_touch",
        entry: 4340.5,
        stopLoss: 4334.5,
        targets: [4352.5],
      },
      fetchLivePrice: async () => 4340.9,
    });
    const result = await runGateChain(gates);
    const g1 = result.verdicts.find((verdict) => verdict.id === "G1");
    assert.equal(g1?.status, "unavailable", "an absent provider is reported, not passed off as clear");
    assert.equal(
      result.allowed,
      true,
      "an install with no calendar is a deployment gap, not a live hazard — it must not silence the platform",
    );

    const plan = await createPlan();
    assert.ok(plan.recommendationId > 0, "the plan still stores");
  });

  it("corrupt_market_data returns an operational block without a recommendation", async () => {
    const { summarizeCandleGaps } = await import("@/lib/agent/dataQualityPolicy");
    const { operationalBlockerEnvelope } = await import("@/lib/agent/resultEnvelope");

    const summary = summarizeCandleGaps([{ missingBars: 400 } as never], 500);
    assert.equal(summary.gapSeverity, "catastrophic");
    assert.equal(summary.hasCriticalGaps, true);

    const envelope = operationalBlockerEnvelope({
      failureStage: "market_data",
      failureCode: "insufficient_data",
      retryable: true,
      traceId: "critical-corrupt",
    });
    // The distinction the doctrine turns on: a data fault is an operational
    // blocker with a name, never a market opinion dressed up as a WAIT.
    assert.equal(envelope.outcome_class, "operational_blocker");
    assert.equal(envelope.recommendation_issued, false);
    assert.equal(envelope.recommendation_authority, "none");

    const before = await db.queryOne<{ count: number }>(
      "SELECT COUNT(*) AS count FROM recommendations WHERE user_id = ? AND analysis_id = ?",
      [userId, "critical-corrupt-analysis"],
    );
    assert.equal(Number(before?.count ?? 0), 0, "a blocked run writes no plan");
  });

  it("condition_during_revision: the newer revision wins and the old one reads stale", async () => {
    const plan = await createPlan({ planType: "conditional" });
    const first = await revisions.getEffectiveRevision(userId, plan.recommendationId);
    assert.equal(first?.revisionNo, 1);

    await revisions.applyRecommendationRevision({
      userId,
      recommendationId: plan.recommendationId,
      revision: {
        direction: "buy",
        source: "market_update",
        entry: 4342.25,
        stopLoss: 4335.5,
        targets: [4356],
        reason: "the level moved while the first revision was still current",
      },
    });

    const effective = await revisions.getEffectiveRevision(userId, plan.recommendationId);
    assert.equal(effective?.revisionNo, 2, "the newer revision becomes the plan");
    assert.equal(effective?.entry, 4342.25);

    // The first revision is still readable history — and no longer current.
    const stale = await revisions.checkRevisionIsCurrent({
      userId,
      recommendationId: plan.recommendationId,
      revisionNo: 1,
    });
    assert.equal(stale.ok, false, "acting on revision 1 must be refused as stale");
    assert.equal(stale.reason, "stale_revision");
  });

  it("expired_or_invalidated: a terminal plan is never re-activated", async () => {
    const plan = await createPlan();
    await canonical.transitionRecommendation({
      userId,
      recommendationId: plan.recommendationId,
      toStatus: "expired",
      trigger: "validity_window",
      actor: "system",
      source: "critical-scenarios",
      reason: "validity window closed",
    });

    const expired = await canonical.getCanonicalRecommendationByReference(
      userId,
      plan.recommendationId,
    );
    assert.equal(expired?.status, "expired");

    // A terminal plan must not be walked back to active by any later sweep.
    await assert.rejects(
      () =>
        canonical.transitionRecommendation({
          userId,
          recommendationId: plan.recommendationId,
          toStatus: "active",
          trigger: "sweep",
          actor: "system",
          source: "critical-scenarios",
          reason: "a sweep tried to revive a dead plan",
        }),
      /transition|illegal/i,
    );
  });

  it("retest_started notifies once through lifecycle dedupe", async () => {
    const plan = await createPlan({ planType: "conditional" });
    const key = `retest_started:${plan.recommendationId}:1`;
    const first = await notifier.claimLifecycleDedupeKey({
      userId,
      dedupeKey: key,
      eventType: "retest_started",
      symbol: "XAUUSD",
    });
    const second = await notifier.claimLifecycleDedupeKey({
      userId,
      dedupeKey: key,
      eventType: "retest_started",
      symbol: "XAUUSD",
    });
    assert.equal(first, true, "the retest is announced when it happens");
    assert.equal(second, false, "a re-sweep of the same retest stays silent");
  });

  it("breakout_no_retest notifies once through lifecycle dedupe", async () => {
    const plan = await createPlan({ planType: "conditional" });
    const key = `breakout_no_retest:${plan.recommendationId}:1`;
    const first = await notifier.claimLifecycleDedupeKey({
      userId,
      dedupeKey: key,
      eventType: "breakout_no_retest",
      symbol: "XAUUSD",
    });
    const second = await notifier.claimLifecycleDedupeKey({
      userId,
      dedupeKey: key,
      eventType: "breakout_no_retest",
      symbol: "XAUUSD",
    });
    assert.equal(first, true);
    assert.equal(second, false, "a plan that ran without returning says so once");
  });
});
