import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { before, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "aichart-deep-verdict-"));
process.env.DB_PATH = join(dir, "verdict.db");
process.env.ENCRYPTION_KEY = "0".repeat(64);
process.env.APP_SECRET = "verdict-test-secret";
delete process.env.DATABASE_URL;
delete process.env.TELEGRAM_BOT_TOKEN;

/**
 * Deep research verdicts aligned with the plan's trio (plan §14 I), through the
 * database.
 *
 * The old completion path derived reinforced/neutral/contradicted from the sign
 * of a confidence delta, and only "contradicted" did anything — a revision that
 * re-wrote the same levels. These tests pin the reworked contract:
 *
 *   confirmed   → recorded (reevaluations + history), NO revision, notified;
 *   revised     → a real revision through applyRecommendationRevision, via the
 *                 unified cycle because research artifacts carry no levels;
 *   invalidated → executionState set invalidated THROUGH a revision, notified.
 */

let db: typeof import("@/lib/db");
let completion: typeof import("@/lib/agent/deepAnalysis/completion");
let revisions: typeof import("@/lib/recommendations/canonical/revisions");
let repository: typeof import("@/lib/recommendations/canonical/repository");
let userId = 0;

before(async () => {
  db = await import("@/lib/db");
  await db.initDb();
  completion = await import("@/lib/agent/deepAnalysis/completion");
  revisions = await import("@/lib/recommendations/canonical/revisions");
  repository = await import("@/lib/recommendations/canonical/repository");
  userId = await db.insertReturningId(
    "INSERT INTO users (email, password_hash, role, status) VALUES (?,?,?,?)",
    ["verdict@example.com", "x", "user", "active"],
  );
});

/** A live plan with an effective revision, created the way the platform does. */
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
    planType: "conditional",
    executionState: "awaiting_activation",
    status: "active",
    source: "test",
    engineVersion: "verdict-test",
    initialRevision: {
      activationCondition: "إغلاق فوق 4002",
      activationRule: { kind: "candle_close_above", level: 4002, timeframe: "5m" },
      invalidationRule: "إغلاق تحت 3980",
      alternativeScenario: "كسر 3980 يقلب المشهد",
      validityCandles: 8,
      evidence: { atr: 4 },
    },
  });
  return rec.recommendationId;
}

/** A brain answer for the fallback cycle. Same shape the orchestrator returns. */
function brainResult(over: {
  direction?: "buy" | "sell";
  planType?: string;
  entry?: number;
  stopLoss?: number;
  targets?: number[];
  executionState?: string;
} = {}) {
  return {
    decision: over.direction ?? "buy",
    confidence: 62,
    summary: "قرار إعادة التقييم.",
    keyReasons: ["الهيكل"],
    riskWarnings: [],
    activityEvents: [],
    decisionTrace: {
      hypotheses: [{ scenario: "ارتداد", supporting: ["هيكل"], opposing: [] }],
      chosenBecause: "الطلب صمد.",
      planTypeBecause: "السعر بعيد.",
    },
    evidenceDimensions: [{ key: "signal_strength", grade: "moderate", detail: "x" }],
    evidenceSnapshot: {
      schemaVersion: 1,
      modelContext: { signalStrength: "moderate", symbol: "XAUUSD" },
      visualSnapshots: [],
    },
    recommendation: {
      action: over.direction ?? "buy",
      planType: over.planType ?? "conditional",
      executionState: over.executionState ?? "awaiting_activation",
      entry: over.entry ?? 4000,
      stop_loss: over.stopLoss ?? 3980,
      targets: over.targets ?? [4040],
      validityCandles: 8,
      alternativeScenario: "كسر 3980 يقلب المشهد",
      invalidationRule: "إغلاق تحت 3980",
      triggerCondition: "إغلاق فوق 4002",
    },
  } as unknown as import("@/lib/agent/types").AgentFinalResult;
}

const supports = {
  delta: 0.05,
  agreement: "Historical metrics support the setup.",
  metricsPresent: true,
};
const conflicts = {
  delta: -0.08,
  agreement: "Historical metrics conflict with or weaken the setup.",
  metricsPresent: true,
};

async function apply(
  id: number,
  scored: { delta: number; agreement: string; metricsPresent: boolean },
  runBrain?: NonNullable<Parameters<typeof completion.applyDeepResearchVerdict>[1]>["runBrain"],
  analysisId = `analysis-${id}`,
) {
  const rec = await repository.getCanonicalRecommendation(userId, id);
  assert.ok(rec);
  return completion.applyDeepResearchVerdict(
    {
      userId,
      analysisId,
      recommendationId: id,
      recommendationRef: `rec-${id}`,
      recommendation: rec,
      scored,
    },
    runBrain ? { runBrain } : {},
  );
}

async function dedupeCount(keyLike: string): Promise<number> {
  const rows = await db.query<{ n: number }>(
    "SELECT COUNT(*) AS n FROM alert_dedupe WHERE user_id = ? AND dedupe_key = ?",
    [userId, keyLike],
  );
  return Number(rows[0]?.n ?? 0);
}

async function dedupePrefixCount(prefix: string): Promise<number> {
  const rows = await db.query<{ n: number }>(
    "SELECT COUNT(*) AS n FROM alert_dedupe WHERE user_id = ? AND dedupe_key LIKE ?",
    [userId, `${prefix}%`],
  );
  return Number(rows[0]?.n ?? 0);
}

describe("a supporting research run confirms without touching the plan", () => {
  it("records confirmed, writes no revision, and announces it once", async () => {
    const id = await livePlan();
    const outcome = await apply(id, supports, async () => brainResult());

    assert.equal(outcome.verdict, "confirmed");
    assert.equal(outcome.cycle?.verdict, "confirmed");

    // Exactly one revision — the seed. Confirmation is not a plan change.
    assert.equal((await revisions.listRevisions(userId, id)).length, 1);

    // Recorded the way a cycle's confirmation is recorded.
    const rows = await db.query<{ outcome: string; reason: string; source: string }>(
      "SELECT outcome, reason, source FROM recommendation_reevaluations WHERE recommendation_id = ?",
      [`rec-${id}`],
    );
    const confirmed = rows.find((row) => row.outcome === "confirmed");
    assert.ok(confirmed);
    assert.equal(confirmed.reason, "deep_research");
    assert.equal(confirmed.source, "deep_research");

    // In the plan's own history too.
    const history = await repository.listRecommendationHistory(userId, id);
    const entry = history.find(
      (h) => h.kind === "research_completion" && h.payload.verdict === "confirmed",
    );
    assert.ok(entry, "the confirmed verdict must land in recommendation_history");

    // Announced through the lifecycle notifier's dedupe — once.
    const key = `rec-${id}:1:reeval:confirmed:deep_research:`;
    assert.equal(await dedupePrefixCount(key), 1);

    // A re-run of the same completion says nothing new.
    await apply(id, supports);
    assert.equal(await dedupePrefixCount(key), 1);
    assert.equal((await revisions.listRevisions(userId, id)).length, 1);
  });
});

describe("a conflicting run goes through the unified cycle, never invents levels", () => {
  it("applies a real revision through the one mechanism when the brain moves the plan", async () => {
    const id = await livePlan();
    const outcome = await apply(id, conflicts, async () =>
      brainResult({ entry: 3990, stopLoss: 3972 }),
    );

    assert.equal(outcome.verdict, "revised");
    assert.equal(outcome.cycle?.revision?.revisionNo, 2);
    assert.equal(outcome.cycle?.revision?.entry, 3990);

    // The pointer moved: revision 1 is now stale for execution.
    const stale = await revisions.checkRevisionIsCurrent({
      userId,
      recommendationId: id,
      revisionNo: 1,
    });
    assert.equal(stale.ok, false);

    // The cycle recorded its own verdict row for the deep_research trigger.
    const rows = await db.query<{ outcome: string; reason: string }>(
      "SELECT outcome, reason FROM recommendation_reevaluations WHERE recommendation_id = ? AND outcome = 'revised'",
      [`rec-${id}`],
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.reason, "deep_research");

    // Announced once, keyed to the new revision.
    assert.equal(await dedupeCount(`rec-${id}:2:reeval:revised`), 1);

    // History carries the verdict.
    const history = await repository.listRecommendationHistory(userId, id);
    const entry = history.find(
      (h) => h.kind === "research_completion" && h.payload.verdict === "revised",
    );
    assert.ok(entry);
  });

  it("sets executionState invalidated through a revision, never a direct write", async () => {
    const id = await livePlan();
    const outcome = await apply(id, conflicts, async () =>
      brainResult({ executionState: "invalidated", entry: 3950, stopLoss: 3930 }),
    );

    assert.equal(outcome.verdict, "invalidated");
    assert.ok(outcome.cycle?.revision, "invalidation must arrive as a revision");
    assert.equal(outcome.cycle!.revision!.executionState, "invalidated");

    // The revision's pointer move is what wrote the column.
    const row = await db.queryOne<{ execution_state: string | null }>(
      "SELECT execution_state FROM recommendations WHERE id = ?",
      [id],
    );
    assert.equal(row?.execution_state, "invalidated");

    // Announced once as the alternative scenario taking over.
    assert.equal(
      await dedupeCount(`rec-${id}:${outcome.cycle!.revision!.revisionNo}:reeval:invalidated`),
      1,
    );
  });

  it("confirms when the brain re-checks the conflict and stands by the plan", async () => {
    const id = await livePlan();
    const outcome = await apply(id, conflicts, async () => brainResult());

    assert.equal(outcome.verdict, "confirmed");
    // The brain looked; the plan stands; no revision was manufactured.
    assert.equal((await revisions.listRevisions(userId, id)).length, 1);
    assert.equal(
      await dedupePrefixCount(`rec-${id}:1:reeval:confirmed:deep_research:`),
      1,
    );
  });

  it("returns to reporting-only when DEEP_RESEARCH_V2 is rolled back", async () => {
    const { clearPlatformConfigCache } = await import("@/lib/platformConfig");
    const id = await livePlan();
    process.env.DEEP_RESEARCH_V2 = "0";
    clearPlatformConfigCache();
    try {
      const outcome = await apply(id, conflicts, async () =>
        brainResult({ entry: 3990 }),
      );
      assert.equal(outcome.verdict, null);
      assert.equal(outcome.cycle, null);
      assert.equal((await revisions.listRevisions(userId, id)).length, 1);
      // The finding is still recorded — reporting only, not silence.
      const history = await repository.listRecommendationHistory(userId, id);
      const entry = history.find(
        (h) => h.kind === "research_completion" && h.payload.finding === "conflicts",
      );
      assert.ok(entry);
      assert.equal(entry!.payload.originalDecisionPreserved, true);
    } finally {
      delete process.env.DEEP_RESEARCH_V2;
      clearPlatformConfigCache();
    }
  });
});
